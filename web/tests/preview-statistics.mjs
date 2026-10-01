// Isolated browser fixture; never writes the user's model files or workspace.
import {createServer} from 'vite';
const model=id=>({schema_version:'1.2',metadata:{model_id:id,model_name:'Test '+id,estimator:'MLR',data_treatment:'Continuous',latent_variables:['Outcome','Predictor']},
  parameters:[{lhs:'Outcome',op:'~',rhs:'Predictor',section:'regression',est:-.3,se:.2,z:-1.5,pvalue:.17,'ci.lower':-.7,'ci.upper':.1,'std.lv':-.4,'std.all':-.5},
    {lhs:'Outcome',op:'~~',rhs:'Outcome',section:'variance',est:-.1,se:.2,z:-.5,pvalue:.6},
    {lhs:'Predictor',op:'=~',rhs:'item',section:'loading',est:1,se:.1,z:10,pvalue:.001},
    {lhs:'Predictor',op:'=~',rhs:'item2',section:'loading',est:.8,se:.1,z:8,pvalue:.002},
    {lhs:'Predictor',op:'=~',rhs:'item3',section:'loading',est:.7,se:.1,z:7,pvalue:.003}],
  latent_correlations:{kind:'matrix',row_names:['Outcome','Predictor'],column_names:['Outcome','Predictor'],values:[[1,.6],[.6,1]]},fit_measures:[{measure:'cfi',value:.95}]});
const layout={schema_version:'9.0',used_models:['A'],model_positions:{A:{x:120,y:160}},model_sizes:{A:{width:320,height:220}},notes:[],edges:[],stacks:[],decorations:[],hidden_models:[],model_notes:{},viewport:{x:0,y:0,zoom:1}};
const workspace={kind:'sem-workspace',schema_version:'10.0',active_page:'test',pages:[{id:'test',title:'UI verification',type:'model',layout}],sticker_families:[{id:'dataset',name:'Dataset',shape:'ribbon',color:'#8055b8',multiple:false,stickers:[{id:'d1',name:'Dataset final 1',code:'D1',note:'Test note'}]}]};
const server=await createServer({server:{host:'127.0.0.1',port:5196,strictPort:true},plugins:[{name:'statistics-preview',enforce:'pre',configureServer(server){server.middlewares.use((req,res,next)=>{
  const url=req.url?.split('?')[0];let value;
  if(url==='/workspace.json'||url==='/layout.json')value=workspace;
  else if(url==='/model-library.json')value={source:'folder-scan',models:['A','B'].map((id,i)=>({id,title:'Test '+id,image:'models/'+id+'.svg',results:'results/'+id+'.json',jsonModified:`2026-09-${20+i}T00:00:00Z`})),broken:[],warnings:[]};
  else if(/^\/results\/[AB]\.json$/.test(url))value=model(url.split('/').pop().split('.')[0]);
  else if(/^\/models\/[AB]\.svg$/.test(url)){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect x="20" y="40" width="100" height="70" fill="#e3edf7"/><path d="M120 75H200" stroke="#444"/><ellipse cx="250" cy="75" rx="45" ry="35" fill="#eee0f5"/></svg>');return;}
  else return next();res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));
});}}]});
await server.listen();server.printUrls();

