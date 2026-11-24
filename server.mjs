import {createApplication} from './server/http.mjs';

const app=await createApplication();
const port=Number(process.env.PORT||4173),host='127.0.0.1';
app.server.listen(port,host,()=>console.log(`Local: http://${host}:${port}`));
const close=()=>app.close().then(()=>process.exit(0));
process.once('SIGINT',close);process.once('SIGTERM',close);
