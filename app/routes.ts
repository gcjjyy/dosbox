import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),
  route("dos.zip", "routes/dos.zip.tsx"),
  route("dosbox.conf", "routes/dosbox.conf.tsx"),
  route("api/login", "routes/api.login.tsx"),
  route("api/logout", "routes/api.logout.tsx"),
  route("api/save", "routes/api.save.tsx"),
] satisfies RouteConfig;
