use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;

struct SidecarState(Mutex<Option<Child>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let cli_args: Vec<String> = std::env::args().skip(1).collect();
            if !cli_args.is_empty() {
                let code = run_node_cli(app.handle(), &cli_args)?;
                app.handle().exit(code);
                return Ok(());
            }

            let preferred_port = std::env::var("RESUFLOW_PORT")
                .ok()
                .and_then(|value| value.parse::<u16>().ok())
                .unwrap_or(4173);
            let port = available_port(preferred_port)?.to_string();
            let launch_token = Uuid::new_v4().to_string();
            let api_token = Uuid::new_v4().to_string();
            let url = format!("http://127.0.0.1:{port}/?desktop=1&token={api_token}");
            let mut sidecar = spawn_node_sidecar(app.handle(), &port, &launch_token, &api_token)?;

            if !wait_for_sidecar(&port, &launch_token, &mut sidecar, Duration::from_secs(20)) {
                let _ = sidecar.kill();
                let _ = sidecar.wait();
                return Err("ResuFlow could not verify its Node sidecar".into());
            }
            app.manage(SidecarState(Mutex::new(Some(sidecar))));

            let mut builder =
                WebviewWindowBuilder::new(app.handle(), "main", WebviewUrl::External(url.parse()?))
                    .title("ResuFlow")
                    .inner_size(1320.0, 900.0)
                    .min_inner_size(800.0, 600.0)
                    .resizable(true)
                    .center();

            #[cfg(target_os = "windows")]
            {
                builder = builder.additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI");
            }

            builder.build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to start ResuFlow")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app.try_state::<SidecarState>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(mut child) = guard.take() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                }
            }
        });
}

fn run_node_cli(
    app: &tauri::AppHandle,
    args: &[String],
) -> Result<i32, Box<dyn std::error::Error>> {
    let (node, cli) = sidecar_paths(app)?;
    let status = Command::new(node)
        .arg(cli)
        .args(args)
        .env("RESUFLOW_DESKTOP", std::env::current_exe()?)
        .env("RESUFLOW_PACKAGED", "1")
        .status()?;
    Ok(status.code().unwrap_or(1))
}

fn spawn_node_sidecar(
    app: &tauri::AppHandle,
    port: &str,
    launch_token: &str,
    api_token: &str,
) -> Result<Child, Box<dyn std::error::Error>> {
    let (node, cli) = sidecar_paths(app)?;
    let workspace = std::env::var("RESUFLOW_WORKSPACE").ok();

    let mut command = Command::new(node);
    command
        .arg(cli)
        .args(["serve", "--sidecar", "--port", port])
        .env("RESUFLOW_LAUNCH_TOKEN", launch_token)
        .env("RESUFLOW_API_TOKEN", api_token)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    if let Some(workspace) = workspace {
        command.args(["--dir", &workspace]);
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    Ok(command.spawn()?)
}

fn sidecar_paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), Box<dyn std::error::Error>> {
    if let Ok(cli) = std::env::var("RESUFLOW_CLI") {
        let node = std::env::var("RESUFLOW_NODE").unwrap_or_else(|_| "node".into());
        return Ok((PathBuf::from(node), PathBuf::from(cli)));
    }

    let resource_dir = app.path().resource_dir()?;
    let node_name = if cfg!(windows) { "node.exe" } else { "node" };
    for root in [resource_dir.clone(), resource_dir.join("resources")] {
        let node = root.join("runtime").join(node_name);
        let cli = root.join("app").join("bin").join("resuflow.mjs");
        if node.is_file() && cli.is_file() {
            return Ok((command_path(node), command_path(cli)));
        }
    }

    Err("Bundled Node sidecar is missing. Download and reinstall the latest ResuFlow package.".into())
}

fn command_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let value = path.to_string_lossy();
        if let Some(value) = value.strip_prefix(r"\\?\") {
            return PathBuf::from(value);
        }
    }
    path
}

fn available_port(preferred: u16) -> std::io::Result<u16> {
    if let Ok(listener) = TcpListener::bind(("127.0.0.1", preferred)) {
        return Ok(listener.local_addr()?.port());
    }

    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    Ok(listener.local_addr()?.port())
}

fn wait_for_sidecar(port: &str, launch_token: &str, child: &mut Child, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if matches!(child.try_wait(), Ok(Some(_)) | Err(_)) {
            return false;
        }
        if sidecar_health_matches(port, launch_token) {
            return true;
        }
        thread::sleep(Duration::from_millis(150));
    }
    false
}

fn sidecar_health_matches(port: &str, launch_token: &str) -> bool {
    let address = format!("127.0.0.1:{port}");
    let Ok(mut stream) = TcpStream::connect(&address) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));

    let request =
        format!("GET /api/health HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() {
        return false;
    }
    let Some((headers, body)) = response.split_once("\r\n\r\n") else {
        return false;
    };
    if !headers.starts_with("HTTP/1.1 200") {
        return false;
    }

    let Ok(payload) = serde_json::from_str::<serde_json::Value>(body) else {
        return false;
    };
    payload.get("app").and_then(|value| value.as_str()) == Some("resuflow")
        && payload.get("launchToken").and_then(|value| value.as_str()) == Some(launch_token)
}

#[cfg(test)]
mod tests {
    use super::{available_port, sidecar_health_matches};
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn selects_another_port_when_the_preferred_port_is_occupied() {
        let occupied = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let occupied_port = occupied.local_addr().unwrap().port();

        assert_ne!(available_port(occupied_port).unwrap(), occupied_port);
    }

    #[test]
    fn health_check_requires_the_expected_app_and_launch_token() {
        let valid_port = serve_health(r#"{"app":"resuflow","launchToken":"expected"}"#);
        assert!(sidecar_health_matches(&valid_port.to_string(), "expected"));

        let wrong_token_port =
            serve_health(r#"{"app":"resuflow","launchToken":"unexpected"}"#);
        assert!(!sidecar_health_matches(
            &wrong_token_port.to_string(),
            "expected"
        ));

        let wrong_app_port = serve_health(r#"{"app":"another-app","launchToken":"expected"}"#);
        assert!(!sidecar_health_matches(
            &wrong_app_port.to_string(),
            "expected"
        ));
    }

    fn serve_health(body: &'static str) -> u16 {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 512];
            let _ = stream.read(&mut request);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream.write_all(response.as_bytes()).unwrap();
        });
        port
    }
}
