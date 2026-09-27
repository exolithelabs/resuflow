export const PACKAGE_NAME = 'resuflow';
export const DOWNLOAD_URL = process.env.RESUFLOW_DOWNLOAD_URL
  || 'https://github.com/exolithelabs/resuflow/releases/latest/download/ResuFlow-Windows-x64-setup.exe';
export const LINUX_PACKAGE_NAME = 'resuflow';
export const LINUX_ARCH = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
export const LINUX_PACKAGE_FILE = `${LINUX_PACKAGE_NAME}-linux-${LINUX_ARCH}.pkg.tar.zst`;
export const LINUX_PACKAGE_URL = process.env.RESUFLOW_PACKAGE_URL
  || `https://github.com/exolithelabs/resuflow/releases/latest/download/${LINUX_PACKAGE_FILE}`;

export function installApp() {
  console.log(`Windows: download the installer from ${DOWNLOAD_URL}`);
  console.log(`Linux (Arch): install directly with \`sudo pacman -U ${LINUX_PACKAGE_URL}\`, or download ${LINUX_PACKAGE_FILE} and its .sha256 sidecar, verify the checksum, then run \`sudo pacman -U ./${LINUX_PACKAGE_FILE}\` from that folder.`);
  return 0;
}

export function updateApp() {
  console.log(`Windows: download and run the latest ResuFlow installer from ${DOWNLOAD_URL}`);
  console.log(`Linux (Arch): run \`sudo pacman -U ${LINUX_PACKAGE_URL}\` again, or download the newer ${LINUX_PACKAGE_FILE} and install it from that folder with \`sudo pacman -U ./${LINUX_PACKAGE_FILE}\`. Both forms upgrade over the existing package.`);
  return 0;
}

export function uninstallApp() {
  if (process.platform === 'win32') {
    console.log('Uninstall ResuFlow from Windows Settings → Apps.');
  } else {
    console.log(`Run \`sudo pacman -Rns ${LINUX_PACKAGE_NAME}\` from a terminal.`);
  }
  console.log('Your resume workspaces are not removed with the app.');
  return 0;
}
