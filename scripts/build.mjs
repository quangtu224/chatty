// Production frontend build. The server's local .env may say NODE_ENV=development,
// which would make Vite bundle React's slower debug build; force production first,
// before Vite is imported and reads the environment.
process.env.NODE_ENV = "production";
const { build } = await import("vite");
await build();
