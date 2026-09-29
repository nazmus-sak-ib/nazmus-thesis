import {createServer} from 'vite';
import {readFile} from 'node:fs/promises';
const layout={schema_version:'9.0',used_models:['U1a','B1'],model_positions:{U1a:{x:100,y:120},B1:{x:600,y:120}},model_sizes:{U1a:{width:340,height:320},B1:{width:300,height:300}},notes:[],edges:[],stacks:[],decorations:[],hidden_models:[],model_notes:{},viewport:{x:0,y:0,zoom:0.8}};
const workspace={kind:'sem-workspace',schema_version:'10.0',active_page:'cfa-test',pages:[{id:'cfa-test',title:'CFA test',type:'model',layout}]};
const server=await createServer({server:{host:'127.0.0.1',port:5195,strictPort:true},plugins:[{name:'cfa-preview',configureServer(server){server.middlewares.use(async(req,res,next)=>{const url=req.url?.split('?')[0];if(url==='/results/U1a.json'){res.setHeader('Content-Type','application/json');res.end(await readFile('results/U1a.json'));}else if(url==='/layout.json'||url==='/workspace.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(workspace));}else next();});}}]});
await server.listen();server.printUrls();
