'use strict';
const assert = require('node:assert/strict');
const { deflateSync, inflateSync } = require('node:zlib');
const { packQColumn, validatePackedQColumn, packedQColumnCell } = require('../out/notebook-packed-column');
const { qVector, qAtom, qSpecial, qValueToPortableNode, qVectorType } = require('../out/q-value');
const {
  createPortableKxColumnTableV3, createPortableKxPackedTableV4,
  portableTableRow, portableTableCell, validatePortableKxResult, portableTableRowCount,
  notebookResultToCsv, notebookResultPlainText, notebookResultStaticHtml,
} = require('../out/notebook-contract');
const { inspectNotebookKxOutputIdentity, parseNotebookRendererMessage } = require('../out/notebook-message');
const compress = bytes => deflateSync(bytes, { level: 6 });
const id = 'packed-column-test-'+'p'.repeat(32);
const cases = [
  qVector(['XAUUSD','XAUUSD','XAUUSD'],'symbol',1),
  qVector(['00112233-4455-6677-8899-aabbccddeeff'].fill('00112233-4455-6677-8899-aabbccddeeff'),'guid'),
  qVector([false,true,false],'boolean'),
  qVector([0,255,12],'byte'), qVector([0,255,13],'char'),
  qVector([-32766,32766,1],'short'), qVector([-2147483646,2147483646,0],'int'),
  ...['long','timestamp','timespan'].map(type=>qVector(['-9223372036854775806','9223372036854775806',qSpecial('null')],type)),
  ...['month','date','minute','second','time'].map(type=>qVector([-1,1,qSpecial('negativeInfinity')],type)),
  ...['real','float','datetime'].map(type=>qVector([0.1,0.2,qSpecial('negativeZero')],type)),
  qVector([Number.MIN_VALUE,Math.PI,1e300],'float'),
  qVector([Number.MIN_VALUE,-Number.MIN_VALUE,Math.PI],'float'),
  qVector([0.1+0.2,0.3,0.2],'float'),
  qVector([qSpecial('null'),qSpecial('positiveInfinity'),qSpecial('negativeInfinity')],'float'),
  qVector([qVector([],'float',1),qVector([0.1],'float',2),qVector([0.2,0.3],'float',4)],'mixed',3),
  qVector([qVector([],'int',4),qVector([1],'int'),qVector([2,3],'int',1)],'mixed'),
  qVector([qVector([42],'int',1),qVector([42,42],'int',2),qVector([],'int')],'mixed'),
];
for(const vector of cases) {
  const packed = packQColumn(vector, compress);
  assert(packed, 'supported fixture must pack');
  assert(validatePackedQColumn(packed));
  const restored = JSON.parse(JSON.stringify(packed));
  assert(validatePackedQColumn(restored));
  const expected = qValueToPortableNode(vector);
  for(let row=0;row<vector.length;row++) {
    const node = expected.type==='mixed' ? expected.values[row] : {form:'atom',type:expected.type,value:expected.values[row]};
    assert.deepEqual(packedQColumnCell(restored,row), node);
  }
  assert.deepEqual(packQColumn(expected, compress, true), packed,
    'saved-v3 conversion must agree with native packing');
}
assert.equal(packQColumn(qVector([Number.MIN_VALUE,Math.PI,1e300],'float')).encoding,'float64');
assert.equal(packQColumn(qVector([0.1,0.2,0.3],'float')).scale,1);
assert.equal(packQColumn(qVector([0.1+0.2,0.3,0.2],'float')).encoding,'float-predict');
assert.equal(packQColumn(qVector(['A','B'],'symbol')),undefined,'varying symbols retain exact fallback');
assert.equal(packQColumn(qVector([qAtom('int',1),qVector([2],'int')],'mixed')),undefined);
assert.equal(packQColumn(qVector([qVector([1],'int'),qVector([2],'float')],'mixed')),undefined);
const empty = packQColumn(qVector([],'int'));
assert(validatePackedQColumn(empty)); assert.throws(()=>packedQColumnCell(empty,0));

function changedBinary(column, change) {
  const copy = JSON.parse(JSON.stringify(column));
  const raw = Buffer.from(inflateSync(Buffer.from(copy.data,'base64')));
  const changed = change(raw);
  copy.data=deflateSync(changed).toString('base64');copy.decodedBytes=changed.length;
  return copy;
}
const ordinary=packQColumn(qVector([1,2],'int'),compress);
const invalid = [
  p=>{p.extra=true;},p=>{p.version=2;},p=>{p.attribute=5;},p=>{p.type='float';},
  p=>{p.valueType='unknown';},p=>{p.scale=1;},p=>{p.length=3;},p=>{p.elementCount=3;},
  p=>{p.encoding='float64';},p=>{p.data='=aaa';},p=>{p.data=p.data.slice(4);},
  p=>{p.decodedBytes++;},p=>{p.compression='gzip';},p=>{p.constant=1;},
  p=>{p.length=Number.MAX_SAFE_INTEGER;},p=>{p.decodedBytes=0xffffffff;},
];
for(const mutate of invalid) {
  const bad=JSON.parse(JSON.stringify(ordinary));mutate(bad);
  assert(!validatePackedQColumn(bad),String(mutate));
}
assert(!validatePackedQColumn(changedBinary(ordinary,b=>Buffer.concat([b,Buffer.from([0])]))));
assert(!validatePackedQColumn(changedBinary(ordinary,b=>b.subarray(0,b.length-1))));
assert(!validatePackedQColumn(changedBinary(ordinary,b=>{b[0]=5;return b;})));
assert(!validatePackedQColumn(changedBinary(ordinary,b=>Buffer.from([0,0,0x82,0,2]))));
const ragged=packQColumn(qVector([qVector([],'float'),qVector([1,2],'float')],'mixed'),compress);
assert(!validatePackedQColumn(changedBinary(ragged,b=>{b[1]=5;return b;})));
const replacement=changedBinary(ordinary,b=>{b[2]=6;return b;});
assert.deepEqual(packedQColumnCell(ordinary,0),{form:'atom',type:'int',value:1});
ordinary.data=replacement.data;
assert(validatePackedQColumn(ordinary));
assert.deepEqual(packedQColumnCell(ordinary,0),{form:'atom',type:'int',value:3},'changed bytes cannot reuse stale decode');
ordinary.extra=true;assert(!validatePackedQColumn(ordinary));delete ordinary.extra;
const constant=packQColumn(qVector([qSpecial('null')],'float'));
assert(validatePackedQColumn(constant));constant.constant.special='negativeZero';
assert(validatePackedQColumn(constant));assert.deepEqual(packedQColumnCell(constant,0).value,qSpecial('negativeZero'));
constant.constant.extra=true;assert(!validatePackedQColumn(constant));

// Homogeneous ragged and arbitrary nested fallback coexist on the same strict table.
const columns = [
  qVector(['A','B','C'],'symbol',1),
  qVector([qVector([],'float',1),qVector([0.1],'float',2),qVector([Math.PI,Number.MIN_VALUE],'float',4)],'mixed'),
  qVector(['9007199254740993','-9007199254740993',qSpecial('positiveInfinity')],'long'),
  qVector([qAtom('symbol','µ'),{qtype:'generalNull'},qVector([qVector([1,2],'int',2)],'mixed')],'mixed'),
];
const input={columns:columns.map((c,i)=>({name:'c'+i,type:qVectorType(c)})),rows:[],rowCount:3,
  columnAttributes:[{ordinal:0,attribute:1}],keyColumnOrdinals:[0],marker:'direct-ipc',
  chart:{version:1,visible:true,type:'line',xColumn:'c2',yColumns:['c2']}};
const old=createPortableKxColumnTableV3(input,columns,id);
const created=createPortableKxPackedTableV4(input,columns,id,compress);
assert(old.ok,old.error);assert(created.ok,created.error);assert.equal(created.value.version,4);
const payload=JSON.parse(JSON.stringify(created.value));assert(validatePortableKxResult(payload).ok);
assert.equal(portableTableRowCount(payload),3);
for(let r=0;r<3;r++)assert.deepEqual(portableTableRow(payload,r),portableTableRow(old.value,r));
assert.equal(notebookResultToCsv(payload),notebookResultToCsv(old.value));
assert.equal(notebookResultPlainText(payload),notebookResultPlainText(old.value));
assert.equal(notebookResultStaticHtml(payload),notebookResultStaticHtml(old.value));
const meta={'vscode-kdb.outputBinding':{version:1,id}};
assert.equal(inspectNotebookKxOutputIdentity(meta,[{mime:'application/vnd.kx.result+json',value:payload}]).status,'valid');
assert.equal(parseNotebookRendererMessage({type:'openPreview',requestId:1,outputId:id,payload}).payload.version,4);
for(const mutate of [p=>p.data.columns.pop(),p=>p.schema.columns[1].type='float',
  p=>p.result.rowCount++,p=>p.data.columns[1].attribute=3,p=>p.version=3,
  p=>p.persistence.mode='preview',p=>p.outputId='bad',p=>p.data.columns.extra=true]) {
  const bad=JSON.parse(JSON.stringify(payload));mutate(bad);assert(!validatePortableKxResult(bad).ok,String(mutate));
}
assert.deepEqual(portableTableCell(payload,2,1),portableTableCell(old.value,2,1));
console.log('Packed columns: exact numeric/ragged/fallback round trips, mutation and corruption rejection, contract and export/chart parity passed');
