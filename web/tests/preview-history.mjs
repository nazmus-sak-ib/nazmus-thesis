// Isolated browser QA origin. Overrides only the initial layout response;
// does not modify the user's workspace files or normal browser storage.
import { createServer } from 'vite';
const layout={schema_version:'9.0',used_models:['B1','B1.2'],hidden_models:[],
  model_positions:{B1:{x:60,y:80},'B1.2':{x:560,y:80}},
  model_sizes:{B1:{width:260,height:220},'B1.2':{width:260,height:220}},
  model_notes:{B1:'<b>Model note preserved</b>'},stacks:[],decorations:[],
  notes:[{id:'qa-note',position:{x:80,y:420},width:240,height:160,data:{title:'QA canvas note',text:'Original text'}}],
  edges:[{id:'qa-edge',source:'B1',target:'B1.2',sourceHandle:'source-right',targetHandle:'target-left',type:'annotated',data:{noteHtml:'<b>Arrow note preserved</b>',appearance:{color:'#6342a0',thickness:3,head:'filled',ends:'end',size:18}}}],viewport:{x:0,y:0,zoom:0.8}};
const server=await createServer({server:{host:'127.0.0.1',port:5193,strictPort:true},plugins:[{
  name:'isolated-history-preview',configureServer(server){server.middlewares.use((req,res,next)=>{
    if(req.url?.split('?')[0]!=='/layout.json')return next();
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(layout));
  });}
}]});
await server.listen();server.printUrls();
