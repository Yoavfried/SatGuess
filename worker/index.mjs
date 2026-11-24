import {DurableObject} from 'cloudflare:workers';
import schema from '../server/schema.sql';
import {createCloudflareRepository} from '../server/cloudflare-storage.mjs';
import {createWorkerApiHandler} from '../server/worker-http.mjs';
import {loadWorkerCatalog} from '../.worker/catalog.mjs';
import {APP_BASE_PATH} from '../server/public-assets.mjs';
import {routeWorker} from '../server/worker-router.mjs';

export class SatGuessGame extends DurableObject {
  constructor(ctx,env){
    super(ctx,env);
    this.ready=ctx.blockConcurrencyWhile(async()=>{
      // Parse the private catalog inside the object, away from the edge router's CPU budget.
      const catalog=loadWorkerCatalog();
      this.repository=createCloudflareRepository({storage:ctx.storage,schema});
      this.handle=createWorkerApiHandler({repository:this.repository,catalog,publicOrigin:env.PUBLIC_ORIGIN,basePath:APP_BASE_PATH});
    });
  }
  async fetch(request){await this.ready;return this.handle(request);}
}

export default {fetch:routeWorker};
