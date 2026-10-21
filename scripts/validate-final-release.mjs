/** Independently check the final manuscript release, including all binary rows. */
import assert from 'node:assert/strict';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const types = { float64: [8,'readDoubleLE'], uint32: [4,'readUInt32LE'], uint16: [2,'readUInt16LE'], uint8: [1,'readUInt8'] };

export async function validateFinalRelease(root, manifest) {
  const json = async (file, hash) => {
    const bytes = await readFile(join(root,file));
    if (hash) assert.equal(sha(bytes),hash, `${file}: hash mismatch`);
    return JSON.parse(bytes);
  };
  assert.equal(manifest.analysis.test, 'chi-square-three-df-profile-lrt');
  assert.equal(manifest.analysis.fdr_threshold,.05);
  assert.deepEqual(manifest.bmrs.map((b) => b.id),['mutsig']);
  const index = await json('index.json',manifest.index_sha256);
  const evidence = await json('verification.json',manifest.verification_sha256);
  await json('likely-passengers.json',manifest.annotation_sha256);
  assert.equal(sha(await readFile(join(root,'TableS5.csv'))),manifest.table_s5_sha256);
  assert.equal(sha(await readFile(join(root,'README.md'))),manifest.readme_sha256);
  assert.equal(index.cohorts.length,32);
  assert.equal(new Set(index.cohorts.map((c)=>c.id)).size,32);
  let tumors=0, me=0, co=0, tested=0;
  for (const meta of index.cohorts) {
    const data=await json(meta.data_file,meta.data_sha256);
    const proof=evidence.cohorts.find((c)=>`TCGA__${c.cohort}`===meta.id);
    assert.ok(proof);
    assert.equal(data.n_samples,proof.participants);
    assert.equal(data.features.length,500);
    assert.equal(new Set(data.features).size,500);
    assert.equal(data.pair_policy.tested_pairs,124750);
    assert.deepEqual(Object.keys(data.tables).sort(),['baselines','mutsig','pairs']);
    const tables={};
    for (const [name,record] of Object.entries(data.tables)) {
      const compressed=await readFile(join(root,'cohorts',meta.id,record.file));
      assert.equal(compressed.length,record.bytes);
      assert.ok(compressed.length<25*1024*1024);
      assert.equal(sha(compressed),record.sha256);
      const raw=gunzipSync(compressed);
      assert.equal(raw.length,record.raw_bytes);
      assert.equal(sha(raw),record.raw_sha256);
      assert.equal(record.rows,124750);
      let end=0;
      tables[name]={};
      for (const col of record.columns) {
        const [width,read]=types[col.dtype];
        assert.equal(col.offset,end);
        assert.equal(col.offset%width,0);
        const values=new Float64Array(record.rows);
        for(let i=0;i<record.rows;i++) values[i]=raw[read](col.offset+i*width);
        tables[name][col.name]=values;
        end+=width*record.rows;
      }
      assert.equal(end,raw.length);
    }
    const {pairs:p,mutsig:m,baselines:b}=tables;
    const found = new Map();
    const ordered={1:[],2:[]};
    let cohortMe=0,cohortCo=0,previousA=-1,previousB=-1,same=0;
    for(let i=0;i<124750;i++) {
      assert.ok(p.a[i]<p.b[i] && p.b[i]<500);
      assert.ok(p.a[i]>previousA || p.a[i]===previousA && p.b[i]>previousB);
      previousA=p.a[i]; previousB=p.b[i];
      assert.equal(p.observed_both[i]+p.observed_a_only[i]+p.observed_b_only[i]+p.observed_neither[i],data.n_samples);
      const ga=data.features[p.a[i]],gb=data.features[p.b[i]];
      found.set([ga,gb].sort().join(':'),i);
      same+=ga.slice(0,-2)===gb.slice(0,-2) ? 1 : 0;
      assert.ok(m.lrt[i]>=0 && Number.isFinite(m.lrt[i]));
      assert.ok(m.p[i]>=0 && m.p[i]<=1 && m.by_q[i]>=m.p[i] && m.by_q[i]<=1);
      assert.equal(Boolean(m.by_decisions[i]&8),m.by_q[i]<=.05);
      for (const [bit,q] of [.001,.005,.01,.05].entries()) assert.equal(Boolean(m.by_decisions[i]&(1<<bit)),m.by_q[i]<=q);
      if(m.direction[i]===1 || m.direction[i]===2) {
        assert.ok(m.identifiability[i]);
        assert.ok(m.direction[i]===1 ? m.rho[i]<0 : m.rho[i]>0);
        ordered[m.direction[i]].push(i);
      }
      if(m.by_q[i]<=.05 && m.direction[i]===1) cohortMe++;
      if(m.by_q[i]<=.05 && m.direction[i]===2) cohortCo++;
      for(const [name,values] of Object.entries(b)) if(name!=='megsa_lrt') assert.ok(values[i]>=0 && values[i]<=1, `${meta.id}/${name}/${i}`);
    }
    assert.ok(same>0);
    for(const rows of Object.values(ordered)) {
      // Verify ranks without relying on sort stability or locale collation.
      const ranks=rows.map((i)=>m.rank[i]).sort((a,b)=>a-b);
      ranks.forEach((r,i)=>assert.equal(r,i+1));
      const byRank=rows.toSorted((a,b)=>m.rank[a]-m.rank[b]);
      for(let i=1;i<byRank.length;i++) assert.ok(m.lrt[byRank[i-1]]>=m.lrt[byRank[i]]);
    }
    for(const pair of proof.figure_pairs) {
      const i=found.get([pair.ga,pair.gb].sort().join(':'));
      assert.equal(m.lrt[i],pair.lrt); assert.equal(m.rho[i],pair.rho);
      assert.equal(m.by_q[i],pair.by_q); assert.equal(p.observed_both[i],pair.both);
    }
    assert.equal(cohortMe,proof.ME); assert.equal(cohortCo,proof.CO);
    tumors+=data.n_samples; tested+=124750; me+=cohortMe; co+=cohortCo;
  }
  assert.equal(tumors,10433); assert.equal(tested,3992000);
  assert.equal(me,8); assert.equal(co,4);
  process.stdout.write(`${manifest.release_id}: verified ${tumors} tumors, ${tested} pairs; ${me} ME / ${co} CO\n`);
}
