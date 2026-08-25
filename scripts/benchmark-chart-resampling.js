#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const moduleRoot = path.resolve(option('--module-root', process.cwd()));
const label = option('--label', path.basename(moduleRoot));
const outputPath = option('--output', '');
const repetitions = Math.max(1, Number(option('--repetitions', '3')) || 3);
const rowCount = Math.max(8_001, Number(option('--rows', '30000')) || 30_000);
const charting = require(path.join(moduleRoot, 'out', 'charting.js'));
const chartZoom = require(path.join(moduleRoot, 'out', 'chart-zoom.js'));
const packageJson = JSON.parse(fs.readFileSync(path.join(moduleRoot, 'package.json'), 'utf8'));
const seriesCounts = [1, 4, 8, 16];
const epoch = Date.UTC(2000, 0, 1);

function makeTable(kind, yCount) {
  const reads = { x: 0, y: 0 };
  const columns = ['x', ...Array.from({ length: yCount }, (_, index) => `y${index + 1}`)];
  const columnTypes = [kind === 'temporal' ? 'timestamp' : 'long', ...new Array(yCount).fill('float')];
  return {
    reads,
    table: {
      columns,
      columnTypes,
      rowCount,
      cellValue(rowIndex, columnIndex) {
        if (columnIndex === 0) {
          reads.x += 1;
          return kind === 'temporal' ? new Date(epoch + rowIndex * 10) : rowIndex;
        }
        reads.y += 1;
        return Math.sin((rowIndex + columnIndex * 7) / (11 + columnIndex)) * 100 +
          Math.cos(rowIndex / (31 + columnIndex)) * 17 + columnIndex;
      },
    },
  };
}

function request(kind, yCount, requestId, range) {
  return {
    chartType: 'line',
    xColumn: 'x',
    yColumns: Array.from({ length: yCount }, (_, index) => `y${index + 1}`),
    width: 900,
    version: 1,
    requestId,
    maxSourceRows: rowCount,
    maxSampledPoints: 10_000,
    samplingStrategy: kind === 'temporal' ? 'temporal-auto' : 'point-count',
    ...(range ? { xMin: range.min, xMax: range.max } : {}),
  };
}

function xAt(kind, rowIndex) {
  return kind === 'temporal' ? epoch + rowIndex * 10 : rowIndex;
}

function median(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function snapshot(kind, scenario, yCount, elapsed, reads, data) {
  return {
    kind,
    scenario,
    series: yCount,
    medianMs: Number(elapsed.toFixed(3)),
    xReads: reads.x,
    yReads: reads.y,
    eligiblePoints: data.eligibleRowCount,
    sampledPoints: data.sampledPointCount,
    algorithm: data.algorithm,
    samplingLevel: data.temporalBucketIntervalMs === undefined
      ? data.samplingStrategy || 'point-count'
      : `${data.temporalBucketIntervalMs}ms@${data.temporalBucketOrigin || 0}`,
    reusedPoints: data.temporalReusedPointCount || 0,
    builtPoints: data.temporalBuiltPointCount || data.sampledPointCount,
    retainedBytes: Buffer.byteLength(JSON.stringify(data)),
  };
}

function measure(kind, scenario, yCount, build) {
  build();
  const elapsed = [];
  let last;
  for (let index = 0; index < repetitions; index += 1) {
    const started = performance.now();
    last = build();
    elapsed.push(performance.now() - started);
  }
  return snapshot(kind, scenario, yCount, median(elapsed), last.reads, last.data);
}

function cleanBuild(kind, yCount, range) {
  const fixture = makeTable(kind, yCount);
  const data = charting.buildChartData(fixture.table, request(kind, yCount, 1, range));
  return { data, reads: fixture.reads };
}

function panBuild(kind, yCount, overlap) {
  const fixture = makeTable(kind, yCount);
  const spanRows = 12_000;
  const startRow = 4_000;
  const shiftRows = Math.max(1, Math.round(spanRows * (1 - overlap)));
  const baseRange = { min: xAt(kind, startRow), max: xAt(kind, startRow + spanRows - 1) };
  const nextRange = { min: xAt(kind, startRow + shiftRows), max: xAt(kind, startRow + shiftRows + spanRows - 1) };
  const baseRequest = request(kind, yCount, 1, baseRange);
  let base;
  if (typeof charting.buildChartDataWithTemporalPanReuse === 'function') {
    base = charting.buildChartDataWithTemporalPanReuse(fixture.table, baseRequest);
  } else {
    base = { data: charting.buildChartData(fixture.table, baseRequest) };
  }
  fixture.reads.x = 0;
  fixture.reads.y = 0;
  const nextRequest = {
    ...request(kind, yCount, 2, nextRange),
    ...(kind === 'temporal' && Number.isFinite(base.data.temporalBucketIntervalMs)
      ? {
        samplingStrategy: 'temporal-fixed',
        temporalBucketIntervalMs: base.data.temporalBucketIntervalMs,
      }
      : {}),
  };
  const built = typeof charting.buildChartDataWithTemporalPanReuse === 'function'
    ? charting.buildChartDataWithTemporalPanReuse(fixture.table, nextRequest, base.cache)
    : { data: charting.buildChartData(fixture.table, nextRequest) };
  return { data: built.data, reads: fixture.reads };
}

function interactionFrameTrace() {
  const pointerMoves = 200;
  if (typeof chartZoom.ChartFrameCoalescer !== 'function') {
    return {
      mode: 'historical-uncoalesced',
      pointerMoves,
      scheduledFrames: pointerMoves,
      appliedViewportUpdates: pointerMoves,
      canceledFrames: 0,
      finalRange: { min: pointerMoves - 1, max: pointerMoves },
    };
  }
  const callbacks = new Map();
  let nextFrameId = 0;
  let scheduledFrames = 0;
  let canceledFrames = 0;
  const applied = [];
  const coalescer = new chartZoom.ChartFrameCoalescer(
    callback => {
      nextFrameId += 1;
      scheduledFrames += 1;
      callbacks.set(nextFrameId, callback);
      return nextFrameId;
    },
    frameId => {
      canceledFrames += 1;
      callbacks.delete(frameId);
    },
    range => applied.push(range)
  );
  for (let index = 0; index < 120; index += 1) {
    coalescer.queue({ min: index, max: index + 1 });
  }
  const firstFrame = callbacks.entries().next().value;
  callbacks.delete(firstFrame[0]);
  firstFrame[1]();
  for (let index = 120; index < pointerMoves; index += 1) {
    coalescer.queue({ min: index, max: index + 1 });
  }
  coalescer.flush({ min: pointerMoves, max: pointerMoves + 1 });
  coalescer.queue({ min: -1, max: 0 });
  coalescer.cancel();
  return {
    mode: 'deterministic-browser-raf-model',
    pointerMoves,
    scheduledFrames,
    appliedViewportUpdates: applied.length,
    canceledFrames,
    finalRange: applied[applied.length - 1],
  };
}

const results = [];
for (const yCount of seriesCounts) {
  for (const kind of ['numeric', 'temporal']) {
    results.push(measure(kind, 'initial', yCount, () => cleanBuild(kind, yCount)));
    const deepStart = 9_000;
    const deepRange = {
      min: xAt(kind, deepStart),
      max: xAt(kind, Math.min(rowCount - 1, deepStart + 9_999)),
    };
    results.push(measure(kind, 'deep-refill', yCount, () => cleanBuild(kind, yCount, deepRange)));
    for (const overlap of [0.9, 0.7, 0.4]) {
      results.push(measure(kind, `pan-${Math.round(overlap * 100)}`, yCount, () =>
        panBuild(kind, yCount, overlap)));
    }
  }
}

const report = `${JSON.stringify({
  schemaVersion: 1,
  label,
  packageVersion: packageJson.version,
  moduleRoot,
  rowCount,
  repetitions,
  seriesCounts,
  interactionFrames: interactionFrameTrace(),
  results,
}, null, 2)}\n`;
if (outputPath) {
  const resolvedOutput = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, report);
  process.stdout.write(`chart benchmark written to ${resolvedOutput}\n`);
} else {
  process.stdout.write(report);
}
