// Some Windows workspace filesystems return EISDIR for readlink on ordinary
// files. Next's dependency tracer expects Node's usual EINVAL instead.
// Preserve real symlink errors and all other filesystem behavior.
if (process.platform === 'win32') {
  const fs = require('node:fs');
  const normalize = (error, path) => {
    if (error?.code === 'EISDIR') {
      try { if (!fs.lstatSync(path).isSymbolicLink()) error.code = 'EINVAL'; } catch {}
    }
    return error;
  };
  const readlink = fs.readlink.bind(fs);
  fs.readlink = (path, ...args) => {
    const callback = args.pop();
    return readlink(path, ...args, (error, target) => callback(normalize(error, path), target));
  };
  const readlinkSync = fs.readlinkSync.bind(fs);
  fs.readlinkSync = (path, ...args) => {
    try { return readlinkSync(path, ...args); } catch (error) { throw normalize(error, path); }
  };
  const readlinkPromise = fs.promises.readlink.bind(fs.promises);
  fs.promises.readlink = async (path, ...args) => {
    try { return await readlinkPromise(path, ...args); } catch (error) { throw normalize(error, path); }
  };
}
