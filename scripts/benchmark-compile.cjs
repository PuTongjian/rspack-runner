// Research harness: edits only its own fixture, never the target project.
const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const assert = require('node:assert/strict');
const { createFsFromVolume, Volume } = require('memfs');
const { rspack, HotModuleReplacementPlugin, lazyCompilationMiddleware } = require('@rspack/core');
const { createConfig } = require('../src/adapter.cjs');
const runner = path.resolve(__dirname, '..');
const researchCache = path.join(runner, '.cache');
const variant = process.argv[2] || 'baseline';
const fixture = path.join(researchCache, 'perf-fixture');
const project = path.resolve(runner, '../assets-supervision-ui');
const vue = path.join(fixture, 'Probe.vue');
const render = (template, script, style) => `<script setup lang="ts">import {ref} from 'vue';const n=ref<number>(${script});</script><template><div class="perf-probe">PERF_${template} {{n}}</div></template><style lang="scss">.perf-probe{color:$base-color-primary;padding:${style}px;}</style>`;
function walk(rules, visit) { for (const r of rules) { for (const k of ['oneOf','rules']) if (r[k]) walk(r[k], visit); if (r.use) r.use = r.use.flatMap(visit); } }
async function main() {
  await fs.mkdir(fixture, { recursive: true });
  await fs.writeFile(path.join(fixture, 'main.ts'), "import {createApp} from 'vue';import Probe from './Probe.vue';createApp(Probe).mount('#perf-probe');");
  await fs.writeFile(vue, render(0,1,1));
  const setup = performance.now();
  const optimized = variant.startsWith('optimized');
  const {config} = await createConfig(optimized ? {project, lazy:variant === 'optimized', embeddedSass:variant !== 'optimized-project-sass'} : {project, lazy:false, persistent:false, embeddedSass:false, devtool:'cheap-module-source-map'});
  const initial = config.entry.app;
  config.entry = {app: [...(Array.isArray(initial) ? initial : [initial]), path.join(fixture,'main.ts')]};
  config.plugins.push(new HotModuleReplacementPlugin());
  config.output.path = path.join(fixture, 'out');
  if (variant !== 'baseline') config.cache = true;
  if (variant === 'baseline') { config.cache = false; config.experiments.cache = false; }
  else if (!optimized) config.experiments.cache = {type:'memory'};
  if (!optimized && variant !== 'no-compression') walk(config.module.rules,u=>u.loader?.includes('babel-loader') ? {...u,options:{...u.options,cacheCompression:u.options.cacheIdentifier ? false : true,cacheDirectory:u.options.cacheDirectory.replace('babel-uncompressed','babel')}} : u);
  if (variant === 'eval') config.devtool = 'eval-cheap-module-source-map';
  if (variant === 'no-map') config.devtool = false;
  if (variant === 'no-compression') walk(config.module.rules,u=>u.loader?.includes('babel-loader') ? {...u,options:{...u.options,cacheCompression:false}} : u);
  if (variant === 'no-babel') walk(config.module.rules,u=>u.loader?.includes('babel-loader') ? [] : u);
  if (variant === 'sass-modern') walk(config.module.rules,u=>u.loader?.includes('sass-loader') ? {...u,options:{...u.options,api:'modern',sassOptions:{...u.options?.sassOptions,style:'expanded'}}} : u);
  if (variant === 'no-split') config.optimization.splitChunks = false;
  if (variant === 'lazy') config.lazyCompilation = {entries:false,imports:true};
  if (variant === 'persistent') {
    config.cache = true;
    config.experiments = {...config.experiments,cache:{type:'persistent',buildDependencies:[path.join(runner,'src/adapter.cjs'),path.join(runner,'src/tsrs-loader.cjs')],storage:{type:'filesystem',directory:path.join(researchCache,'perf-persistent')}}};
  }
  const compiler = rspack(config);
  if(config.lazyCompilation) lazyCompilationMiddleware(compiler);
  const volume = new Volume();
  compiler.outputFileSystem = createFsFromVolume(volume);
  // Drive watcher notifications explicitly, excluding OS watch delay and network.
  compiler.watchFileSystem = { watch() { return { close(){},pause(){},getInfo(){return {changes:new Set(),removals:new Set(),fileTimeInfoEntries:new Map(),contextTimeInfoEntries:new Map()};} }; } };
  const rows=[];
  let phase='initial', before=performance.now(), resolveNext, rejectNext;
  let template=0, script=1, style=1;
  let built=0, counts={};
  compiler.hooks.compilation.tap('perf',c=>c.hooks.succeedModule.tap('perf',m=>{
    built++;
    const id=m.identifier();
    for(const kind of ['tsrs-loader','babel-loader','sass-loader','vue-loader']) if(id.includes(kind))counts[kind]=(counts[kind]||0)+1;
  }));
  const next=()=>new Promise((resolve,reject)=>{resolveNext=resolve;rejectNext=reject;});
  const first = next();
  const watching = compiler.watch({},(error,stats)=>{
    const callbackMs=Math.round(performance.now()-before);
    if(error) return rejectNext(error);
    if(stats.hasErrors()) return rejectNext(new Error(stats.toString({all:false,errors:true})));
    const assets=stats.compilation.getAssets().map(a=>({name:a.name,size:a.source.size()}));
    const hot=assets.filter(a=>a.name.endsWith('.hot-update.js'));
    if(phase!=='initial') assert.ok(hot.length || assets.some(a=>a.name.endsWith('.hot-update.json')),'HMR asset emitted');
    if(phase.startsWith('template')) {
      const text=hot.map(a=>compiler.outputFileSystem.readFileSync(path.join(config.output.path,a.name),'utf8')).join('\n');
      assert.ok(text.includes(`PERF_${template}`),'HMR includes the updated template');
    }
    const row={variant,phase,wallMs:Math.round(performance.now()-before),callbackMs,compilerMs:stats.endTime-stats.startTime,built,counts,hash:stats.hash,hotBytes:hot.reduce((n,a)=>n+a.size,0)};
    rows.push(row);console.log(JSON.stringify(row));
    built=0;counts={};resolveNext(stats);
  });
  try {
    await first;
    const cssFiles = Object.entries(volume.toJSON()).filter(([name])=>name.endsWith('.css')).sort(([a],[b])=>a.localeCompare(b));
    await fs.writeFile(path.join(researchCache,`perf-${variant}-css.json`),JSON.stringify(cssFiles));
    console.log(JSON.stringify({variant,setupMs:Math.round(before-setup),initialAssetBytes:Object.values(volume.toJSON()).reduce((n,v)=>n+(v?Buffer.byteLength(v):0),0)}));
    for(let round=1;round<=2;round++) {
      for(const kind of ['template','script','style']) {
        phase=`${kind}-${round}`;
        if(kind==='template') template++;
        if(kind==='script') script++;
        if(kind==='style') style++;
        const done=next();
        await fs.writeFile(vue,render(template,script,style));
        compiler.inputFileSystem.purge?.(vue);
        before=performance.now();
        watching.invalidateWithChangesAndRemovals(new Set([vue]),new Set());
        await done;
      }
    }
    await fs.writeFile(path.join(researchCache,`perf-${variant}.json`),JSON.stringify(rows,null,2));
  } finally {
    await new Promise(resolve=>watching.close(resolve));
    await new Promise((resolve,reject)=>compiler.close(e=>e?reject(e):resolve()));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
