'use strict';
// Real webview/renderer checks using Chromium's built-in DevTools protocol.
const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module'), assert = require('assert');
const ROOT = path.resolve(__dirname, '..'), TEST_OUT_ROOT = ROOT + '/out';
const ARTIFACT_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'kx-results-display-'));
const ts = require(ROOT + '/node_modules/typescript');
const src = fs.readFileSync(ROOT + '/test/run.js', 'utf8');
const ast = ts.createSourceFile('tests.js', src, ts.ScriptTarget.Latest, true);
const names = ['createQTextResultsPanelHarness', 'requireOutWithVscode', 'requireOutWithMocks'];
const fns = ast.statements.filter(s => ts.isFunctionDeclaration(s) && names.includes(s.name.text)).map(s => s.getText(ast)).join('\n');
const harnessFactory = new Function('require', 'ROOT', 'TEST_OUT_ROOT', 'Module', 'path', 'assert', fns + '; return {createQTextResultsPanelHarness,requireOutWithVscode};');
const lib = harnessFactory(require, ROOT, TEST_OUT_ROOT, Module, path, assert);
(async () => {
    assert(process.env.VSCODE_KDB_CHROME, 'Set VSCODE_KDB_CHROME to a Chromium executable.');
    const harness = lib.createQTextResultsPanelHarness();
    harness.setSetting('vscode-kdb.results.viewer.autoFitColumns', false);
    harness.setSetting('vscode-kdb.results.viewer.columnWidths', { 0: 90, 1: 90 });
    harness.setSetting('vscode-kdb.results.viewer.tableDecimalPlaces', 2);
    const { KxResultsPanel } = lib.requireOutWithVscode('kx-results-panel', harness.vscode);
    const reporting = require(ROOT + '/out/failure-record');
    const forwardedFailures = [];
    reporting.configureFailureObserver(undefined, { enabled: true, generation: 7 },
        (component, operation, failure) => { forwardedFailures.push({ component, operation, failure });
            throw new Error('report receiver unavailable'); });
    const { createColumnarPanelResult } = require(ROOT + '/out/kx-results');
    const { qAtom } = require(ROOT + '/out/q-value');
    const table = createColumnarPanelResult(['long_header_to_fit', 'price'], 3, (r, c) => c ? qAtom('float', 1234567.123456) : 'long content that must determine fitted width ' + r, ['symbol', 'float']);
    KxResultsPanel.showResult(harness.context, { mode: 'table', table, query: 'fixture', connectionName: 'test', elapsedMs: 1, messages: [] }, 'new');
    await harness.emitMessage(0, { type: 'ready' });
    const panel = harness.panels[0];
    assert(panel.posted.some(message => message.type === 'kxFailureReporting' && message.enabled),
        'a newly ready Results panel receives the configured reporting state');
    const messages = panel.posted;
    let html = panel.webview.html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '').replace(/vscode-webview-resource:\/\//g, 'file://');
    // Serve real host replies via CDP binding, keeping all production webview code intact.
    const prelude = `<script>window.errors=[];window.postedToHost=[];window.addEventListener('error',e=>errors.push(e.message));window.acquireVsCodeApi=()=>({getState:()=>null,setState:()=>{},postMessage:m=>{if(window.throwKxAction&&m.type==='openResultSettings')throw new TypeError('private callback fixture');window.postedToHost.push(m);window.hostMessage(JSON.stringify(m));}});</script>`;
    html = html.replace('<head>', '<head>' + prelude);
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'panel.html'), html);
    const cp = require('child_process');
    const chrome = cp.spawn(process.env.VSCODE_KDB_CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', '--user-data-dir=' + path.join(ARTIFACT_DIR, 'profile'), '--allow-file-access-from-files', 'about:blank'], { env: { ...process.env, XDG_CONFIG_HOME: path.join(ARTIFACT_DIR, 'config'), XDG_CACHE_HOME: path.join(ARTIFACT_DIR, 'cache'), LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH } });
    let stderr = '';
    const endpoint = await new Promise((resolve, reject) => { chrome.stderr.on('data', d => { stderr += d; const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match)
        resolve(match[1]); }); chrome.on('exit', c => reject(Error('chrome exit ' + c + ' ' + stderr))); });
    const port = new URL(endpoint).port;
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
    await new Promise(r => ws.onopen = r);
    let seq = 0;
    const pending = new Map();
    const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
    ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.id) {
            const p = pending.get(m.id);
            pending.delete(m.id);
            if (m.error)
                p.reject(m.error);
            else
                p.resolve(m.result);
        }
        else if (m.method === 'Runtime.bindingCalled') {
            const msg = JSON.parse(m.params.payload);
            harness.emitMessage(0, msg).catch(console.error);
        }
    };
    const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails)
        throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
    panel.postListeners.add(m => { send('Runtime.evaluate', { expression: `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(m)}}))` }).catch(() => { }); });
    try {
        await send('Runtime.enable');
        await send('Runtime.addBinding', { name: 'hostMessage' });
        await send('Emulation.setDeviceMetricsOverride', { width: 700, height: 700, deviceScaleFactor: 2, mobile: false });
        await send('Page.navigate', { url: 'file://' + path.join(ARTIFACT_DIR, 'panel.html') });
        await new Promise(r => setTimeout(r, 800));
        assert.deepStrictEqual(await evaluate('errors'), []);
        // The checkbox is in a details menu; dispatch the same change event as a click.
        const before = await evaluate(`Array.from(document.querySelectorAll('[data-column]')).slice(0,4).map(e=>[e.tagName,e.getBoundingClientRect().width])`);
        await evaluate(`document.getElementById('autoFit').checked=true;document.getElementById('autoFit').dispatchEvent(new Event('change'));`);
        await new Promise(r => setTimeout(r, 500));
        const after = await evaluate(`({errors, widths:Array.from(document.querySelectorAll('[data-column]')).slice(0,4).map(e=>[e.tagName,e.getBoundingClientRect().width]),text:document.body.innerText.slice(-500)})`);
        assert.deepStrictEqual(after.errors, []);
        assert(after.widths[0][1] > before[0][1]);
        assert(after.widths[2][1] > before[2][1]);
        assert(after.text.includes('1234567.12'));
        console.log('Autofit and rounded table cells passed');
        await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'kxFailureReporting',enabled:true,generation:7}}));window.dispatchEvent(new ErrorEvent('error',{message:'foreign VS Code failure'}));`);
        assert.strictEqual(await evaluate(`postedToHost.filter(m=>m.type==='kxFailure').length`), 0,
            'foreign browser errors are never harvested');
        await evaluate(`window.throwKxAction=true;document.getElementById('openResultSettings').click();`);
        await new Promise(resolve => setTimeout(resolve, 100));
        assert.strictEqual(forwardedFailures.length, 1);
        assert.strictEqual(forwardedFailures[0].component, 'results-renderer');
        assert(!JSON.stringify(forwardedFailures).includes('private callback fixture'));
        await evaluate(`const nested=new RangeError('private nested renderer fixture');window.dispatchEvent(new MessageEvent('message',{data:{type:'chartData',get data(){throw nested;}}}));`);
        await new Promise(resolve => setTimeout(resolve, 100));
        assert.strictEqual(forwardedFailures.length, 2, 'an exception crossing both owned guards is forwarded once');
        await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'kxFailureReporting',enabled:false,generation:8}}));document.getElementById('openResultSettings').click();window.throwKxAction=false;window.errors=[];`);
        await new Promise(resolve => setTimeout(resolve, 100));
        assert.strictEqual(forwardedFailures.length, 2, 'disabled callbacks do not forward failures');
        console.log('Results owned callback capture, foreign exclusion and unavailable receiver passed');
        const screenshot = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(ARTIFACT_DIR, 'autofit.png'), Buffer.from(screenshot.data, 'base64'));
        // Exercise actual production formatter and uPlot layout in the browser.
        const panelSource = fs.readFileSync(ROOT + '/src/kx-results-panel.ts', 'utf8');
        const axisSizing = panelSource.match(/function chartYAxisSize\(plot, values\) \{[\s\S]*?\n      \}/)[0];
        const xPadding = panelSource.match(/function chartXAxisEndPadding\(plot\) \{[\s\S]*?\n      \}/)[0];
        const numberFormat = require(ROOT + '/out/number-display');
        const chart = await evaluate(`(async()=>{const host=document.createElement('div');document.body.append(host);const ctx=document.createElement('canvas').getContext('2d');const font='24px sans-serif';const settings={fontSize:24};const chartData={xKind:'numeric'};${numberFormat.scientificNotationThreshold.toString()};${numberFormat.formatNumericAxis.toString()};function formatChartNumber(v){return formatNumericAxis(v,12,1e6);};${axisSizing};${xPadding};const labels=[-1e12,0,1e12].map(v=>v.toExponential(12));ctx.font=font;const measured=Math.max(...labels.map(v=>ctx.measureText(v).width));const plot=new uPlot({width:620,height:280,series:[{},{}],scales:{x:{time:false}},padding:[16,p=>chartXAxisEndPadding(p),8,8],axes:[{}, {font,values:()=>labels,size:(plot,values)=>chartYAxisSize(plot,values)}]},[[-1e12,0,1e12],[-1e12,0,1e12]],host);await new Promise(requestAnimationFrame);return {measured,rightPadding:chartXAxisEndPadding(plot),axisSize:plot.axes[1]._size,plotWidth:plot.bbox.width,values:plot.axes[1]._values,scale:plot.scales.y};})()`);
        console.log('High-DPI axis measurement passed');
        assert(chart.axisSize >= chart.measured + 24);
        assert(chart.rightPadding >= chart.measured / 2 + 12);
        // Exercise the exact production gaps refiners with real uPlot paths.
        const panelGaps = panelSource.match(/function chartSeriesSourceGaps\(series\) \{[\s\S]*?\n      \}/)[0];
        const rendererSource = fs.readFileSync(ROOT + '/renderer/index.ts', 'utf8');
        const rendererAst = ts.createSourceFile('renderer.ts', rendererSource, ts.ScriptTarget.Latest, true);
        const notebookGaps = ts.transpileModule(rendererAst.statements.find(n =>
          ts.isFunctionDeclaration(n) && n.name?.text === 'notebookSeriesSourceGaps').getText(rendererAst),
          { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
        const gapHelpers = require(ROOT + '/out/chart-zoom');
        const nullGapResult = [];
        for (const ratio of [1,2]) {
          await send('Emulation.setDeviceMetricsOverride', {width:700,height:700,deviceScaleFactor:ratio,mobile:false});
          const result = await evaluate(`(async()=>{
            const uPlot=window.uPlot;
            uPlot.pxRatio=${ratio};
            ${gapHelpers.mergeChartPixelGaps.toString()};${gapHelpers.chartSourceGapPixels.toString()};
            ${notebookGaps};
            const reports=[];
            for(const type of ['line','step'])for(const surface of ['panel','notebook'])for(const kind of ['long','coincident']){
              const xs=kind==='long'?[0,1,2,3,4,5]:[0,1,1,2];
              const ys=kind==='long'?[10,11,null,null,14,15]:[10,11,14,15];
              const flags=kind==='long'?[false,false,false,false,true,false]:[false,false,true,false];
              const chartData={x:xs};${panelGaps};
              // The panel helper closes over this local chartData.
              const gapFn=surface==='panel'?chartSeriesSourceGaps({values:ys,gapBefore:flags})
                :notebookSeriesSourceGaps(xs,ys,flags);
              const host=document.createElement('div');document.body.append(host);
              const options={width:620,height:200,scales:{x:{time:false}},axes:[{show:false},{show:false}],
                series:[{}, {stroke:'#ff00ff',width:1.5,spanGaps:false,points:{show:false},gaps:gapFn,
                  ...(type==='step'?{paths:uPlot.paths.stepped({align:1})}:{})}]};
              const plot=new uPlot(options,[xs,ys],host);await new Promise(requestAnimationFrame);
              const gapX=plot.valToPos(kind==='long'?2.5:1,'x',true);
              const gapY=plot.valToPos(kind==='long'?11:12.5,'y',true);
              const paths=plot.series[1]._paths;
              if(!paths.clip||plot.ctx.isPointInPath(paths.clip,gapX,gapY))throw Error(surface+' '+type+' '+kind+' null bridge is not clipped');
              const finiteX=plot.valToPos(.5,'x',true),finiteY=plot.valToPos(10.5,'y',true);
              if(!plot.ctx.isPointInPath(paths.clip,finiteX,finiteY))throw Error('finite run was clipped');
              reports.push({surface,type,kind,ratio:${ratio},gaps:paths.gaps,missingNotPlotted:plot.data[1].filter(v=>v===null).length});
              plot.destroy();host.remove();
            }
            return reports;
          })()`);
          assert.strictEqual(result.length,8);nullGapResult.push(...result);
        }
        await send('Emulation.setDeviceMetricsOverride',{width:700,height:700,deviceScaleFactor:2,mobile:false});
        console.log('Real panel/notebook line/step null gap clipping passed at DPI 1 and 2');
        const { createPortableKxResultV2, KX_NOTEBOOK_MIME } = require(ROOT + '/out/notebook-contract');
        const saved = createPortableKxResultV2({ columns: [{ name: 'price', type: 'float' }, { name: 'label', type: 'symbol' }], rows: [[qAtom('float', 1.23456), 'long notebook content to fit']], marker: 'direct-ipc' }, { outputId: 'results-display-browser-01234567890123456789012345678901', persistenceMode: 'full' });
        assert(saved.ok);
        const shared = lib.requireOutWithVscode('kx-results-panel', harness.vscode).sharedKxResultSettings();
        const notebookResult = await evaluate(`(async()=>{
  const module=await import('file://${ROOT}/renderer/kx-notebook-renderer.js');
  let receive;const messages=[];
  const renderer=module.activate({getState:()=>null,setState:()=>{},onDidReceiveMessage:f=>{receive=f;},postMessage:m=>messages.push(m)});
  receive({type:'settings',presentation:'inline',resultSettings:${JSON.stringify({ ...shared, autoFitColumns: false, columnWidths: { 0: 90, 1: 90 }, tableDecimalPlaces: 2 })}});
  const host=document.createElement('div');document.body.append(host);
  const payload=${JSON.stringify(saved.value)};
  renderer.renderOutputItem({id:'browser-output',mime:${JSON.stringify(KX_NOTEBOOK_MIME)},metadata:{},json:()=>payload},host);
  const original=JSON.stringify(payload);
  const auto=host.querySelector('input[aria-label="Auto-fit columns"]');
  auto.checked=true;auto.dispatchEvent(new Event('change'));
  const precision=host.querySelector('input[aria-label="Table decimals"]');
  precision.value='4';precision.dispatchEvent(new Event('change'));
  receive({type:'settings',presentation:'inline',resultSettings:${JSON.stringify({ ...shared, tableDecimalPlaces: 4 })}});
  if (!host.innerText.includes('1.2346') || JSON.stringify(payload)!==original) throw Error('Saved precision update changed identity or failed to render');
  const text=host.innerText;
  const labels=[...host.querySelectorAll('input,select')].map(e=>e.getAttribute('aria-label'));
  return {text,labels,errors,messages};
 })()`);
        assert(notebookResult.text.includes('1.2346'));
        assert.strictEqual(notebookResult.messages.filter(m => m.type === 'setResultColumnWidth' && m.width === 0).length, 2);
        assert(notebookResult.labels.includes('Table decimals'));
        assert(notebookResult.labels.includes('Chart decimal places'));
        assert(!notebookResult.labels.includes('Arrays'));
        assert(!notebookResult.messages.some(m => m.type === 'rerun'));
        assert.deepStrictEqual(notebookResult.errors, []);
        console.log('Saved notebook rendering and quick controls passed');
        const { createPortableKxColumnTableV3, createPortableKxPackedTableV4 } = require(ROOT + '/out/notebook-contract');
        const { qVector } = require(ROOT + '/out/q-value');
        let columnarResult;
        for (const creator of [createPortableKxColumnTableV3,createPortableKxPackedTableV4]) {
        const columnar = creator({
            columns: [{name:'sym',type:'symbol'},{name:'price',type:'float'}], rows: [], rowCount: 1500,
            columnAttributes:[{ordinal:0,attribute:1}],keyColumnOrdinals:[0],marker:'direct-ipc',
        }, [qVector(Array.from({length:1500},(_,i)=>'S'+String(i).padStart(4,'0')),'symbol',1),
            qVector(Array.from({length:1500},(_,i)=>i+0.123456),'float')], 'columnar-browser-'+'c'.repeat(32));
        assert(columnar.ok,columnar.error);
        columnarResult = await evaluate(`(async()=>{
          const module=await import('file://${ROOT}/renderer/kx-notebook-renderer.js');
          let receive;const messages=[];
          const renderer=module.activate({getState:()=>null,setState:()=>{},onDidReceiveMessage:f=>receive=f,postMessage:m=>messages.push(m)});
          const settings=${JSON.stringify({...shared,autoFitColumns:false,tableDecimalPlaces:2})};
          receive({type:'settings',presentation:'inline',resultSettings:settings});
          const host=document.createElement('div');document.body.replaceChildren(host);
          const payload=${JSON.stringify(columnar.value)},original=JSON.stringify(payload);
          renderer.renderOutputItem({id:'columnar-output',mime:${JSON.stringify(KX_NOTEBOOK_MIME)},metadata:{'vscode-kdb.outputBinding':{version:1,id:payload.outputId}},json:()=>payload},host);
          const wrap=host.querySelector('.kx-table-wrap');
          if(!wrap||wrap.getAttribute('aria-rowcount')!=='1501'||!host.innerText.includes('S0000'))throw Error('columnar grid failed');
          wrap.scrollTop=500;wrap.dispatchEvent(new Event('scroll'));await new Promise(requestAnimationFrame);
          const before=wrap.scrollTop;
          receive({type:'settings',presentation:'inline',resultSettings:{...settings,tableDecimalPlaces:4}});
          await new Promise(requestAnimationFrame);
          const after=host.querySelector('.kx-table-wrap').scrollTop;
          if(before<400||after!==before)throw Error('columnar scroll reset');
          [...host.querySelectorAll('button')].find(b=>b.textContent==='Next page').click();
          if(!host.innerText.includes('S0250'))throw Error('columnar page failed');
          host.querySelector('.kx-saved-sort').click();
          const open=[...host.querySelectorAll('button')].find(b=>/KX Results/.test(b.title));
          if(!open)throw Error('missing Results action');open.click();
          const action=messages.find(m=>m.type==='openPreview');
          if(!action||action.outputId!==payload.outputId||action.payload.data.encoding!==payload.data.encoding)throw Error('columnar action identity failed');
          if(JSON.stringify(payload)!==original||messages.some(m=>m.type==='rerun'||m.type==='requestLiveResult'))throw Error('passive action changed output or reran q');
          return {rows:1500,before,after,version:action.payload.version,action:'openPreview',errors};
        })()`);
        assert.deepStrictEqual(columnarResult.errors,[]);
        console.log('Saved version '+columnarResult.version+' grid, scrolling, settings refresh, paging, sort and Results action passed');
        }

        const symbol = createPortableKxResultV2({
          columns:[{name:'value',type:'symbol'}],rows:[[qAtom('symbol','hola')]],
          logicalPresentation:'standalone-symbol',marker:'direct-ipc',
        },{outputId:'symbol-browser-'+'s'.repeat(32),persistenceMode:'full'});
        assert(symbol.ok,symbol.error);
        const symbolResult = await evaluate(`(async()=>{
          const module=await import('file://${ROOT}/renderer/kx-notebook-renderer.js');
          let receive;const messages=[];
          const renderer=module.activate({getState:()=>null,setState:()=>{},onDidReceiveMessage:f=>receive=f,postMessage:m=>messages.push(m)});
          receive({type:'settings',presentation:'inline',resultSettings:${JSON.stringify(shared)}});
          const host=document.createElement('div');document.body.replaceChildren(host);
          const payload=${JSON.stringify(symbol.value)},original=JSON.stringify(payload);
          renderer.renderOutputItem({id:'symbol-output',mime:${JSON.stringify(KX_NOTEBOOK_MIME)},metadata:{'vscode-kdb.outputBinding':{version:1,id:payload.outputId}},json:()=>payload},host);
          if(host.querySelector('table')||!host.querySelector('pre')||!host.querySelector('pre').textContent.includes('\x60hola'))throw Error('symbol must render as qText');
          [...host.querySelectorAll('button')].find(b=>b.textContent==='Export').click();
          const action=messages.find(m=>m.type==='exportPreviewText');
          if(!action||action.outputId!==payload.outputId||JSON.stringify(action.payload)!==original)throw Error('symbol text export must send canonical source');
          [...host.querySelectorAll('button')].find(b=>/KX Results/.test(b.title)).click();
          if(!messages.some(m=>m.type==='openPreview'&&JSON.stringify(m.payload)===original))throw Error('symbol Results handoff source mismatch');
          if(JSON.stringify(payload)!==original||messages.some(m=>m.type==='rerun'||m.type==='requestLiveResult'))throw Error('symbol passive action mutated or requeried');
          return {text:host.innerText,errors};
        })()`);
        assert.deepStrictEqual(symbolResult.errors,[]);
        console.log('Saved standalone symbol qText, canonical export and Results actions passed');

        const rendererFailureResult = await evaluate(`(async()=>{
          const module=await import('file://${ROOT}/renderer/kx-notebook-renderer.js');
          let receive;const messages=[];
          const renderer=module.activate({getState:()=>null,setState:()=>{},onDidReceiveMessage:f=>receive=f,postMessage:m=>messages.push(m)});
          const original=new TypeError('private renderer fixture');
          const host={replaceChildren(){throw original;}};
          function fail(){try{renderer.renderOutputItem({id:'owned-failure'},host);}catch(error){if(error!==original)throw Error('operation outcome changed');}}
          fail();if(messages.some(m=>m.type==='kxFailure'))throw Error('disabled capture');
          receive({type:'kxFailureReporting',enabled:true,generation:11});fail();fail();
          const failures=messages.filter(m=>m.type==='kxFailure');
          if(failures.length!==1||failures[0].component!=='notebook-renderer'||failures[0].generation!==11)throw Error('enabled forwarding failed');
          if(JSON.stringify(failures).includes('private renderer fixture'))throw Error('message leaked');
          receive({type:'kxFailureReporting',enabled:false,generation:12});fail();
          if(messages.filter(m=>m.type==='kxFailure').length!==1)throw Error('disabled replay');
          return {captured:1,originalErrorPreserved:true,disabled:true};
        })()`);
        assert.strictEqual(rendererFailureResult.originalErrorPreserved,true);
        console.log('Notebook renderer opt-in capture, clearing and original exception preservation passed');

        fs.writeFileSync(path.join(ARTIFACT_DIR, 'evidence.json'), JSON.stringify({ before, after, chart, nullGapResult, notebookResult, columnarResult, symbolResult }, null, 2));
        console.log('Browser evidence: ' + ARTIFACT_DIR);
    }
    finally {
        reporting.configureFailureObserver(undefined, { enabled: false, generation: 8 });
        ws.close();
        chrome.kill();
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
