export type ActionResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string };
