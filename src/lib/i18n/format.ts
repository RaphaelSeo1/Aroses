/**
 * Tiny interpolation helper for dictionary strings, e.g.
 * `tf(t.auth.welcomeBack, { app: APP_NAME })` where the template is
 * "Welcome back to {app}.". Dictionaries stay plain JSON-serializable strings
 * so they can cross the server -> client boundary.
 */
export function tf(
  template: string,
  vars: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match
  );
}
