import { readJson } from "@/lib/http";
import { getConsent, setConsent } from "@/lib/linqext/consent";
import { linqextUser } from "@/lib/linqext/keyboard-auth";
import { userFailure } from "@/lib/users/auth";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

/** GET: what this account has agreed to for reply assist. */
export async function GET(request: Request) {
  try { return Response.json({ data: await getConsent((await linqextUser(request, false)).id) }, { headers }); }
  catch (error) { return userFailure(error); }
}

/** PUT { version, replyAssist, context }: records the user's choice. Withdrawing (false) stops processing immediately. */
export async function PUT(request: Request) {
  try {
    const user = await linqextUser(request, true);
    return Response.json({ data: await setConsent(user.id, await readJson(request, 400)) }, { headers });
  } catch (error) { return userFailure(error); }
}
