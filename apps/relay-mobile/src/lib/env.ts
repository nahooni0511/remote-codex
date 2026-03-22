export function getExpoPublicEnv(name: string): string {
  const value = (process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is required. Define it in apps/relay-mobile/.env.`);
  }

  return value;
}
