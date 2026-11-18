// Builds a portable Windows app folder: release/eradnotes-win32-x64/eradnotes.exe
// Run with: npm run package
import { packager } from '@electron/packager';

const paths = await packager({
  dir: '.',
  out: 'release',
  name: 'eradnotes',
  executableName: 'eradnotes',
  platform: 'win32',
  arch: 'x64',
  overwrite: true,
  prune: true, // only runtime dependencies are copied
  asar: false, // the speech engine loads native ONNX Runtime binaries, which cannot run from inside an asar archive
  ignore: [/^\/(src|scripts|\.devdata|release|\.claude|\.vscode)(\/|$)/, /^\/(index\.html|vite\.config\.js|README\.md)$/],
  win32metadata: { CompanyName: 'eradnotes', FileDescription: 'eradnotes - personal AI notes', ProductName: 'eradnotes' },
});
console.log(`Packaged: ${paths.join(', ')}`);
