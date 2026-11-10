export class OllamaError extends Error { constructor(message,status=502){super(message);this.status=status} }
export async function generateOllama({baseUrl,model,messages,maxTokens,timeoutMs,signal,fetchImpl=fetch}) {
  const ctrl=new AbortController();
  const timeout=setTimeout(()=>ctrl.abort(),timeoutMs);
  const abort=()=>ctrl.abort();
  signal?.addEventListener('abort',abort,{once:true});
  try {
    const res=await fetchImpl(`${baseUrl}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,messages,stream:false,options:{num_predict:maxTokens},keep_alive:'5m'}),signal:ctrl.signal,redirect:'error'});
    if (!res.ok) throw new OllamaError('Private inference unavailable',res.status===404?503:502);
    const payload=await res.json();
    if(typeof payload?.message?.content!=='string') throw new OllamaError('Invalid private inference response');
    return {text:payload.message.content, inputTokens:Number.isSafeInteger(payload.prompt_eval_count)?payload.prompt_eval_count:null,outputTokens:Number.isSafeInteger(payload.eval_count)?payload.eval_count:null};
  } catch(err){if(err instanceof OllamaError)throw err;throw new OllamaError('Private inference unavailable',503)}
  finally {clearTimeout(timeout);signal?.removeEventListener('abort',abort)}
}
