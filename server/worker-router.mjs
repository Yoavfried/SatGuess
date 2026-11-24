import {APP_BASE_PATH} from './public-assets.mjs';

function decorate(response){const headers=new Headers(response.headers);headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','strict-origin-when-cross-origin');headers.set('X-Robots-Tag','noindex');return new Response(response.body,{status:response.status,statusText:response.statusText,headers});}
export async function routeWorker(request,env){
  const url=new URL(request.url),path=url.pathname;
  if(path===APP_BASE_PATH){return decorate(new Response(null,{status:308,headers:{Location:APP_BASE_PATH+'/','Cache-Control':'no-cache'}}));}
  if(!path.startsWith(APP_BASE_PATH+'/'))return decorate(new Response('Not found',{status:404}));
  if(path.startsWith(APP_BASE_PATH+'/api/')){
    const id=env.GAME.idFromName('game-v1');
    return decorate(await env.GAME.get(id).fetch(request));
  }
  if(!['GET','HEAD'].includes(request.method))return decorate(new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}}));
  return decorate(await env.ASSETS.fetch(request));
}
