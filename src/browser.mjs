import open from 'open';

export function openBrowser(url) {
  try {
    const localUrl = normalizeLocalAppUrl(url);
    void open(localUrl, { wait: false }).catch((error) => {
      console.warn(`Could not open a browser: ${error.message}`);
    });
  } catch (error) {
    console.warn(`Could not open a browser: ${error.message}`);
  }
}

export function normalizeLocalAppUrl(value) {
  const url = new URL(String(value));
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new TypeError('Only a local ResuFlow URL can be opened.');
  }
  return url.href;
}
