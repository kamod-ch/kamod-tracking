import type { BrowserCollectHandler } from "./browser-collector";
import type { ServerCollectHandler } from "./server-collector";

type HonoApp = {
  post(path: string, handler: (context: HonoContext) => Response | Promise<Response>): void;
  options(path: string, handler: (context: HonoContext) => Response | Promise<Response>): void;
};

type HonoContext = {
  req: {
    raw: Request;
  };
};

/**
 * Minimal Hono mount helper. Requires `hono` in the host application.
 */
export const mountBrowserCollectOnHono = (
  app: HonoApp,
  path: string,
  handler: BrowserCollectHandler,
): void => {
  app.options(path, async (context) => handler(context.req.raw));
  app.post(path, async (context) => handler(context.req.raw));
};

export const mountServerCollectOnHono = (
  app: HonoApp,
  path: string,
  handler: ServerCollectHandler,
): void => {
  app.post(path, async (context) => handler(context.req.raw));
};
