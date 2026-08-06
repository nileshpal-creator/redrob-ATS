import { withApiHandler } from "@/lib/api/handlers";
import { getControlledListValues } from "@/lib/services/controlled-lists";

type RouteParams = { key: string };

export const GET = withApiHandler<unknown, RouteParams>(async (_context, _request, params) => {
  return getControlledListValues(params.key);
});
