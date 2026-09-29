// Separate QA origin with simulated file saves. No files or normal browser
// workspace storage are written by this harness.
import { createServer } from 'vite';
const layout={schema_version:'9.0',used_models:['B1','B1.2'],hidden_models:[],
  model_positions:{B1:{x:60,y:160},'B1.2':{x:560,y:160}},model_sizes:{B1:{width:260,height:220},'B1.2':{width:260,height:220}},
  model_notes:{B1:'<b>Model preview text</b><p>Second line of the model note.</p>'},stacks:[],notes:[],decorations:[],
  edges:[{id:'qa-arrow',source:'B1',target:'B1.2',sourceHandle:'source-right',targetHandle:'target-left',data:{noteHtml:'<i>Arrow preview text</i>'}}],
  viewport:{x:0,y:0,zoom:0.8},comparison_ids:['B1','B1.2']};
const workspace={kind:'sem-workspace',schema_version:'10.0',active_page:'qa-a',pages:[{id:'qa-a',title:'QA models',type:'model',layout},...['b','c'].map(id=>({id:'qa-'+id,title:'QA '+id.toUpperCase(),type:'blank',layout:{schema_version:'9.0',used_models:[],notes:[],stacks:[],edges:[],decorations:[],model_notes:{},model_sizes:{},model_positions:{},hidden_models:[]}}))]};
const script=`window.showSaveFilePicker=async()=>({createWritable:async()=>({write:async()=>{},close:async()=>{if(document.querySelector('#qa-fail-save').checked)throw Error('Simulated write failure');document.querySelector('#qa-save-result').textContent='Simulated save completed';},abort:async()=>{}})});
document.addEventListener('DOMContentLoaded',()=>{const section=document.createElement('section');section.style='position:fixed;right:12px;bottom:5px;z-index:6000;background:white;border:1px solid #aaa;padding:5px;font:11px sans-serif';section.innerHTML='<label><input type="checkbox" id="qa-fail-save">Simulate save failure</label><output id="qa-save-result"></output>';document.body.append(section);});`;
const server=await createServer({server:{host:'127.0.0.1',port:5194,strictPort:true},plugins:[{
 name:'isolated-ui-preview',transformIndexHtml(){return [{tag:'script',children:script,injectTo:'head'}];},
 configureServer(server){server.middlewares.use((req,res,next)=>{if(req.url?.split('?')[0]!=='/layout.json')return next();res.setHeader('Content-Type','application/json');res.end(JSON.stringify(workspace));});}
}]});
await server.listen();server.printUrls();
