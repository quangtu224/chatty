// The server's local NODE_ENV=development must not select React's debug build.
process.env.NODE_ENV='production';
const {build}=await import('vite');
await build();
