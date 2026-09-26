import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { listResumes, loadResume, saveResume, createResume, loadProfile, saveProfile } from './workspace.mjs';
import { listSkills, loadSkill, createSkill, saveSkill, deleteSkill } from './skills-store.mjs';
import { loadMemory, saveMemory, appendMemory } from './memory.mjs';
import { CURRENT_VERSION } from './releases.mjs';

export function createResumeMcpServer(workspaceRoot) {
  const server = new McpServer({
    name: 'resuflow',
    version: CURRENT_VERSION,
  });

  const text = (value) => ({
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  });

  server.registerTool('list_resumes', {
    description: 'List resumes in the local workspace.',
  }, async () => text(await listResumes(workspaceRoot)));

  server.registerTool('get_resume', {
    description: 'Read a resume Markdown file by slug.',
    inputSchema: { slug: z.string().describe('Resume slug') },
  }, async ({ slug }) => text(await loadResume(workspaceRoot, slug)));

  server.registerTool('write_resume', {
    description: 'Overwrite a resume Markdown file. Include YAML frontmatter.',
    inputSchema: {
      slug: z.string(),
      markdown: z.string(),
    },
  }, async ({ slug, markdown }) => text(await saveResume(workspaceRoot, slug, { markdown })));

  server.registerTool('create_resume', {
    description: 'Create a new resume from a title.',
    inputSchema: { title: z.string() },
  }, async ({ title }) => text(await createResume(workspaceRoot, { title })));

  server.registerTool('get_profile', {
    description: 'Read shared profile Markdown.',
  }, async () => text(await loadProfile(workspaceRoot)));

  server.registerTool('write_profile', {
    description: 'Overwrite shared profile Markdown.',
    inputSchema: { markdown: z.string() },
  }, async ({ markdown }) => text(await saveProfile(workspaceRoot, { markdown })));

  server.registerTool('list_skills', {
    description: 'List enabled built-in and user skills.',
  }, async () => {
    const skills = await listSkills(workspaceRoot, { includeDisabled: false });
    return text(skills.map(({ slug, name, description, source, enabled }) => ({ slug, name, description, source, enabled })));
  });

  server.registerTool('get_skill', {
    description: 'Read a skill by slug.',
    inputSchema: { slug: z.string() },
  }, async ({ slug }) => text(await loadSkill(workspaceRoot, slug)));

  server.registerTool('create_skill', {
    description: 'Create a custom user skill.',
    inputSchema: {
      name: z.string(),
      markdown: z.string().optional(),
    },
  }, async ({ name, markdown }) => text(await createSkill(workspaceRoot, { name, markdown })));

  server.registerTool('write_skill', {
    description: 'Update a custom skill Markdown file. Built-in skills cannot be edited.',
    inputSchema: {
      slug: z.string(),
      markdown: z.string(),
    },
  }, async ({ slug, markdown }) => text(await saveSkill(workspaceRoot, slug, { markdown })));

  server.registerTool('delete_skill', {
    description: 'Delete a custom skill. Built-in skills cannot be deleted.',
    inputSchema: { slug: z.string() },
  }, async ({ slug }) => {
    await deleteSkill(workspaceRoot, slug);
    return text({ ok: true, slug });
  });

  server.registerTool('get_memory', {
    description: 'Read durable memory notes.',
  }, async () => text(await loadMemory(workspaceRoot)));

  server.registerTool('write_memory', {
    description: 'Replace memory Markdown.',
    inputSchema: { markdown: z.string() },
  }, async ({ markdown }) => text(await saveMemory(workspaceRoot, { markdown })));

  server.registerTool('append_memory', {
    description: 'Append a dated note to memory.',
    inputSchema: { note: z.string() },
  }, async ({ note }) => text(await appendMemory(workspaceRoot, note)));

  server.registerPrompt('draft_resume', {
    description: 'Draft or improve a role-specific resume using workspace files.',
    argsSchema: {
      slug: z.string().describe('Resume slug to edit'),
      role: z.string().optional().describe('Target role'),
    },
  }, async ({ slug, role }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Use the resuflow MCP tools. Read profile, memory, skills, and resume "${slug}". Improve that resume for ${role || 'the target role'} without inventing employers, dates, or metrics.`,
      },
    }],
  }));

  return server;
}

export async function handleMcpRequest(req, res, body, workspaceRoot) {
  const server = createResumeMcpServer(workspaceRoot);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
}

export function mcpSnippet(url, token) {
  const headers = { Authorization: `Bearer ${token}` };
  return {
    url,
    grok: {
      mcpServers: {
        'resuflow': {
          type: 'http',
          url,
          headers,
        },
      },
    },
    cursor: {
      mcpServers: {
        'resuflow': {
          url,
          headers,
        },
      },
    },
    generic: {
      mcpServers: {
        'resuflow': {
          url,
          headers,
        },
      },
    },
  };
}
