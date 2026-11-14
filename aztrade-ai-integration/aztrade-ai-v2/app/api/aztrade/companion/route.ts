import { companionGateway } from '@/lib/aztrade/companion-gateway';
export const runtime='nodejs';
export const dynamic='force-dynamic';
// A query-string path is never accepted, avoiding arbitrary URL proxying.
// Explicit route selection remains restricted to the server allowlist.
export async function GET(request:Request) {
  const path=new URL(request.url).searchParams.get('resource');
  if (!path || !/^(paper|portfolio|risk|assistant\/history)$/.test(path)) return Response.json({error:'NOT_FOUND'},{status:404});
  return companionGateway(request,path.split('/'));
}
export async function POST(request:Request) {
  const path=new URL(request.url).searchParams.get('resource');
  if(path!=='assistant/chat') return Response.json({error:'NOT_FOUND'},{status:404});
  return companionGateway(request,path.split('/'));
}
