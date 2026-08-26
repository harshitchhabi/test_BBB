// auth.ts — ported as-is from the legacy repo's root auth.ts.
import { getServerSession } from "next-auth";
import { authOptions } from "./src/auth";

export const auth = () => getServerSession(authOptions);
