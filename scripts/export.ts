// The installed executable runs dist/cli.js directly; this is a workspace convenience.
try {
  await import(new URL('../dist/cli.js', import.meta.url).href);
} catch (error) {
  console.error('Run bun run build before exporting from a source checkout.');
  throw error;
}
