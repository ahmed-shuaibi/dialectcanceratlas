#!/usr/bin/env python3
"""Export completed v5 manuscript results. No model fitting or simulations.

Usage: python scripts/export-final-results.py --source /path/to/dialect \
  --manuscript /path/to/collaborator_revision_20261009_v5 --release-id k500-2026-10-20
Published directories are write-once. All source receipts and table hashes are checked.
"""
import argparse
import gzip
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import chi2


def digest(data):
    return hashlib.sha256(data).hexdigest()


def load(path):
    return json.loads(Path(path).read_text())


def checked(record):
    path = Path(record['path'])
    data = path.read_bytes()
    assert len(data) == record['bytes'] and digest(data) == record['sha256'], path
    return path


def receipt(path):
    path = Path(path)
    data = path.read_bytes()
    return {'path': str(path), 'bytes': len(data), 'sha256': digest(data)}


def write_json(path, value):
    path.write_text(json.dumps(value, separators=(',', ':'), allow_nan=False) + '\n')
    return receipt(path)


def bh(p):
    order = np.argsort(p, kind='stable')
    q = np.minimum(1, np.minimum.accumulate((p[order] * len(p) / np.arange(1, len(p)+1))[::-1])[::-1])
    result = np.empty_like(q)
    result[order] = q
    return result


def table(root, name, columns):
    dtype_order = {'float64': 0, 'uint32': 1, 'uint16': 2, 'uint8': 3}
    specs, chunks, offset = [], [], 0
    for key, array in sorted(columns.items(), key=lambda kv: dtype_order[kv[1].dtype.name]):
        array = np.asarray(array, dtype=array.dtype.newbyteorder('<'))
        specs.append({'name': key, 'dtype': array.dtype.name, 'offset': offset})
        chunk = array.tobytes()
        chunks.append(chunk)
        offset += len(chunk)
    raw = b''.join(chunks)
    data = gzip.compress(raw, compresslevel=6, mtime=0)
    file = name + '.bin.gz'
    (root / file).write_bytes(data)
    return {'file': file, 'rows': len(array), 'columns': specs, 'bytes': len(data),
            'sha256': digest(data), 'raw_bytes': len(raw), 'raw_sha256': digest(raw)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--manuscript', type=Path, required=True)
    parser.add_argument('--release-id', required=True)
    args = parser.parse_args()
    atlas = Path(__file__).resolve().parents[1]
    output = atlas / 'public/data/releases' / args.release_id
    assert not output.exists(), 'Immutable release already exists'
    source = args.source / 'output/tcga_revision_mutsig_repair_v5'
    report = source / 'reporting_adopted_v2'
    overall = load(report / 'complete.json')
    assert overall['status'] == 'complete-all32-v5-primary-reporting'
    assert overall['reporting_rule'] == {'reference': 'chi-square', 'df': 3, 'method': 'by', 'q_threshold': .05}
    independent = load(source / 'reporting_independent_readback_v2/complete.json')
    assert independent['status'] == 'complete-independent-all32-v5-reporting-readback'
    # Working source files can change after the completed run. Verify data and
    # completion artifacts; retain the historical code bindings in their receipt.
    for item in overall.get('bindings', []):
        if '/output/' in item['path']:
            checked(item)
    intake_path = args.manuscript / 'figures/all32_curve_intake_preparation_v1/completed_intake.json'
    intake = load(intake_path)
    assert intake['status'] == 'complete-all32-five-method-curve-intake'
    expected = pd.read_csv(report / 'TableS5.csv').set_index('cohort')
    old_index = load(atlas / 'public/data/releases/k500-2026-09-25/index.json')
    metadata = {row['cohort']: row for row in old_index['cohorts']}
    drivers_path = args.source / 'data/references/OncoKB_Cancer_Gene_List.tsv'
    drivers = set(pd.read_csv(drivers_path, sep='\t')['Hugo Symbol'])
    assert receipt(drivers_path)['sha256'] == '56cea460e396451395738dbb8dbda5f5a8fe6fb146dde18c902c8b6bd6034193'
    figure = args.manuscript / 'documents/sources/manuscript/figure_provenance/figure_quality_refresh_v1'
    biological = pd.read_csv(figure / 'biology/2_completed_pair_evidence.csv', float_precision='round_trip')
    output.mkdir(parents=True)
    cohorts, annotations, evidence = [], {}, []
    bindings = [receipt(report / 'complete.json'), receipt(report / 'TableS5.csv'), receipt(intake_path), receipt(source / 'reporting_independent_readback_v2/complete.json')]
    for candidate in intake['candidate_rows']:
        name = candidate['cohort']
        contract_path = source / 'contracts' / (name + '.json')
        contract = load(contract_path)
        features = contract['features']
        assert len(features) == 500 and len(set(features)) == 500
        axis = {feature: i for i, feature in enumerate(features)}
        aa, bb = np.triu_indices(500, 1)
        size = len(aa)
        canonical = pd.MultiIndex.from_arrays([np.array(features)[aa], np.array(features)[bb]])
        def align(frame):
            x = frame['Gene A'].map(axis).to_numpy()
            y = frame['Gene B'].map(axis).to_numpy()
            assert np.isfinite(x).all() and np.isfinite(y).all()
            frame = frame.copy()
            frame['Gene A'] = np.array(features)[np.minimum(x, y)]
            frame['Gene B'] = np.array(features)[np.maximum(x, y)]
            frame = frame.set_index(['Gene A', 'Gene B'])
            assert frame.index.is_unique and len(frame) == size and set(frame.index) == set(canonical)
            return frame.reindex(canonical)
        completion = load(report / name / 'complete.json')
        assert completion['status'] == 'complete-v5-common-rule-primary-reporting'
        for artifact in completion.get('artifacts', []):
            checked(artifact)
        primary_path = report / name / 'pairwise_results.csv.gz'
        frame = align(pd.read_csv(primary_path, float_precision='round_trip'))
        p = frame['P Value'].to_numpy()
        q = frame['BY Q Value'].to_numpy()
        lrt = frame['Likelihood Ratio'].to_numpy()
        assert np.allclose(p, chi2.sf(lrt, 3), atol=1e-14, rtol=1e-10)
        assert np.allclose(q, np.minimum(1, bh(p) * np.sum(1 / np.arange(1, size+1))), atol=1e-12, rtol=1e-10)
        rho = frame['Rho'].to_numpy()
        identified = frame['Effect Identified'].to_numpy(dtype=bool)
        direction = np.zeros(size, dtype=np.uint8)
        direction[identified & (rho < 0)] = 1
        direction[identified & (rho > 0)] = 2
        direction[identified & (rho == 0)] = 3
        rank = np.zeros(size, dtype=np.uint32)
        gene_a, gene_b = canonical.get_level_values(0).to_numpy(), canonical.get_level_values(1).to_numpy()
        lexical_a, lexical_b = gene_a, gene_b
        for code in (1, 2):
            inds = np.flatnonzero(direction == code)
            order = inds[np.lexsort((lexical_b[inds], lexical_a[inds], -lrt[inds]))]
            rank[order] = np.arange(1, len(order)+1)
        bits = np.zeros(size, dtype=np.uint8)
        for i, cutoff in enumerate((.001, .005, .01, .05)):
            bits[q <= cutoff] |= 1 << i
        cols = {key: frame[col].to_numpy(dtype=np.float64) for key, col in {
            'lrt': 'Likelihood Ratio', 'p': 'P Value', 'by_q': 'BY Q Value', 'log_p': 'Log P Value',
            'log_by_q': 'Log BY Q Value', 'rho': 'Rho', 'tau00': 'Tau 00', 'tau10': 'Tau 10',
            'tau01': 'Tau 01', 'tau11': 'Tau 11'}.items()}
        cols.update(bh_q=bh(p), log_odds_ratio=np.full(size, np.nan), wald=np.full(size, np.nan),
                    rank=rank, direction=direction, identifiability=identified.astype(np.uint8), by_decisions=bits,
                    same_gene=frame['Same Gene M:N'].to_numpy(dtype=np.uint8),
                    shared_snv_events=frame['Shared Physical SNV Events'].to_numpy(dtype=np.uint32),
                    shared_snv_participants=frame['Participants With Shared SNV'].to_numpy(dtype=np.uint16))
        counts_path = source / 'contract_cohorts' / name / 'count_matrix.csv'
        counts = pd.read_csv(counts_path, index_col=0)
        assert counts.columns.tolist() == features and counts.index.is_unique
        assert counts.shape[0] == expected.loc[name, 'participants']
        binary = (counts.to_numpy() > 0).astype(np.int64)
        margins = binary.sum(axis=0)
        both = (binary.T @ binary)[aa, bb]
        pairs = dict(a=aa.astype(np.uint16), b=bb.astype(np.uint16), observed_both=both.astype(np.uint16),
                     observed_a_only=(margins[aa]-both).astype(np.uint16), observed_b_only=(margins[bb]-both).astype(np.uint16),
                     observed_neither=(len(counts)-margins[aa]-margins[bb]+both).astype(np.uint16))
        base, baseline_records = {}, []
        for method, record in candidate['completion_records'].items():
            done = load(checked(record))
            assert done['status'] == 'complete-raw-descriptive-only' and done['tested_pairs'] == size
            raw = align(pd.read_csv(checked(done['artifact']), float_precision='round_trip'))
            baseline_records.extend([record, done['artifact']])
            mappings = {'light': {'fisher_me_p': "Fisher's ME P-Val", 'fisher_co_p': "Fisher's CO P-Val", 'discover_me_p': 'DISCOVER ME P-Val', 'discover_co_p': 'DISCOVER CO P-Val'},
                        'megsa': {'megsa_lrt': 'MEGSA S-Score (LRT)', 'megsa_p': 'MEGSA P-Val'},
                        'wesme': {'wesme_p': 'WeSME P-Val', 'wesco_p': 'WeSCO P-Val'}}
            for key, col in mappings[method].items():
                base[key] = raw[col].to_numpy(dtype=np.float64)
                assert np.isfinite(base[key]).all()
            if method == 'light':
                assert np.array_equal(raw['Both Mutated'].to_numpy(), both)
        for key in list(base):
            if key.endswith('_p'):
                assert ((base[key] >= 0) & (base[key] <= 1)).all()
                base[key[:-1]+'q'] = bh(base[key])
        final_me, final_co = int(((direction == 1) & (q <= .05)).sum()), int(((direction == 2) & (q <= .05)).sum())
        assert final_me == expected.loc[name, 'ME'] and final_co == expected.loc[name, 'CO']
        assert int(cols['same_gene'].sum()) == expected.loc[name, 'same_gene_pairs']
        destinations = output / 'cohorts' / ('TCGA__' + name)
        destinations.mkdir(parents=True)
        tables = {'pairs': table(destinations, 'pairs', pairs), 'mutsig': table(destinations, 'mutsig', cols), 'baselines': table(destinations, 'baselines', base)}
        summary = {'tested_pairs': size, 'identifiable_pairs': int(identified.sum()),
                   'directions': {label: int((direction == i).sum()) for i, label in enumerate(['unavailable', 'ME', 'CO', 'neutral'])},
                   'by_q_le_0_05': {'total': int((q <= .05).sum()), 'ME': final_me, 'CO': final_co, 'direction_unavailable': int(((q <= .05) & (direction == 0)).sum())}}
        data = {'id': 'TCGA__'+name, 'k': 500, 'n_samples': len(counts), 'features': features, 'drivers': sorted(drivers & {f.rsplit('_', 1)[0] for f in features}),
                'pair_policy': {'tested_pairs': size, 'same_gene_pairs_included': True},
                'enums': {'direction': ['unavailable','ME','CO','neutral'], 'identifiability': ['unidentified','identified']},
                'decision_thresholds': [.001,.005,.01,.05], 'tables': tables, 'summaries': {'models': {'mutsig': summary}}}
        file_record = write_json(destinations / 'cohort.json', data)
        meta = {key: value for key, value in metadata[name].items() if key not in ('data_sha256', 'data_bytes', 'table_bytes', 'model_summaries', 'baseline_summary')}
        meta.update(n_samples=len(counts), median_mutations=float(np.median(counts.sum(axis=1))), data_sha256=file_record['sha256'], data_bytes=file_record['bytes'],
                    table_bytes=sum(t['bytes'] for t in tables.values()), model_summaries={'mutsig':summary})
        cohorts.append(meta)
        annotations['TCGA__'+name] = [f for f in features if f.rsplit('_',1)[0] not in drivers][:100]
        cohort_evidence = {'cohort': name, 'participants': len(counts), 'pairs': size, 'ME': final_me, 'CO': final_co,
                           'inputs': [receipt(contract_path), receipt(counts_path), receipt(primary_path), *baseline_records], 'figure_pairs': [], 'network_checks': []}
        for _, row in biological[biological['cohort'] == name].iterrows():
            key = (row['Gene A'],row['Gene B'])
            if axis[key[0]] > axis[key[1]]: key = key[::-1]
            idx = canonical.get_loc(key)
            assert np.isclose(lrt[idx], row['Likelihood Ratio'], atol=1e-12, rtol=0)
            assert np.isclose(rho[idx], row['Rho'], atol=1e-12, rtol=0)
            assert both[idx] == row['Observed Both'] and q[idx] <= .05
            cohort_evidence['figure_pairs'].append({'ga':key[0], 'gb':key[1], 'lrt':float(lrt[idx]), 'rho':float(rho[idx]), 'both':int(both[idx]), 'by_q':float(q[idx])})
        network_path = figure / 'networks' / name / 'ranked_pairs.csv'
        if network_path.exists():
            net = pd.read_csv(network_path)
            native = {'DIALECT':-lrt, 'DISCOVER':base['discover_me_p'], "Fisher's Exact Test":base['fisher_me_p'], 'Fisher':base['fisher_me_p'], 'MEGSA':-base['megsa_lrt'], 'WeSME':base['wesme_p']}
            for method, group in net.groupby('method', sort=False):
                if method not in native: raise ValueError(method)
                selected = np.flatnonzero(direction == 1) if method == 'DIALECT' else np.arange(size)
                ordered = selected[np.lexsort((lexical_b[selected], lexical_a[selected], native[method][selected]))]
                got = {tuple(sorted((gene_a[i],gene_b[i]))) for i in ordered[:len(group)]}
                want = {tuple(sorted((r['Gene A'],r['Gene B']))) for _,r in group.iterrows()}
                assert got == want, (name,method,got^want)
                cohort_evidence['network_checks'].append({'method':method,'top_pairs':len(group),'matched':True})
        evidence.append(cohort_evidence)
        if name == 'CHOL':
            idx = np.flatnonzero((direction == 1) & (rank == 1))[0]
            assert set((gene_a[idx],gene_b[idx])) == {'IDH1_M','PBRM1_N'}
        print(name, len(counts), final_me, final_co, flush=True)
    assert len(cohorts) == 32 and sum(c['n_samples'] for c in cohorts) == 10433
    assert sum(e['ME'] for e in evidence)==8 and sum(e['CO'] for e in evidence)==4
    annotation_record = write_json(output / 'likely-passengers.json', {'annotation_id': 'likely-passengers-v1', 'schema_version':'1.0.0', 'driver_reference':'OncoKB_Cancer_Gene_List.tsv', 'definition':'Top 100 observed-count-ranked loci outside OncoKB, separately in each final cohort.', 'driver_reference_sha256':receipt(drivers_path)['sha256'], 'cohorts':annotations})
    index_record = write_json(output / 'index.json', {'release_id':args.release_id,'cohorts':cohorts})
    verification_record = write_json(output / 'verification.json', {'status':'verified-completed-source-tables-and-figures', 'inputs':bindings, 'figure_inputs':[receipt(figure/'biology/2_completed_pair_evidence.csv')], 'cohorts':evidence})
    (output/'TableS5.csv').write_bytes((report/'TableS5.csv').read_bytes())
    (output/'README.md').write_text('# Final manuscript results\n\n32 TCGA cohorts; 10,433 participant-unique tumors; 500 loci selected by observed mutation counts per cohort; all 124,750 pairs per cohort, including same-gene M:N pairs.\n\nMutSigCV2 is the primary background. One profile likelihood-ratio test per pair uses the final chi-square reference with 3 degrees of freedom and within-cohort Benjamini–Yekutieli q ≤ 0.05. Direction follows rho. There are 8 ME and 4 CO calls. No model fitting or simulations were performed during export.\n\nFisher, DISCOVER, MEGSA and WeSME/WeSCO native scores come from the completed final 500-locus analyses. BH q values for comparison methods are calculated over the full within-cohort family. MEGSA uses p < 0.001. Ranked examples can be explored independently of significance.\n\nThe source bindings, checks against final Table S5 and the BRCA/UCEC networks and LGG/UCEC biological examples are recorded in verification.json. Shared physical SNV counts are retained in the model table. Such overlap and same-gene pairs need biological interpretation.\n\nCBaSE/DIG analyses from earlier contracts remain available through the historical release selector, and are not mixed into this final-results release.\n')
    manifest = {'release_id':args.release_id,'schema_version':'3.0.0','immutable':True,'generated_at':datetime.now(timezone.utc).isoformat(), 'title':'Final manuscript results',
        'coverage':{'cohorts':32,'samples':10433,'studies':{'TCGA':32},'tested_pairs_per_model':3992000,'dialect_tables':32,'baseline_tables':32,'mutsig_primary_rejections':{'ME':8,'CO':4,'direction_unavailable':0}},
        'analysis':{'contract':'final-v5-all-pairs-chi3-by','top_k_event_features':500,'fdr_threshold':.05,'fdr_operator':'<=','primary_provider':'mutsig','primary_adjustment':'benjamini-yekutieli','primary_q_threshold':.05,'test':'chi-square-three-df-profile-lrt','ranking':'LRT descending, then lexical gene pair','pair_family':'all unordered pairs including same-gene M:N; loci selected by observed mutation counts independent of DIG coverage'},
        'encoding':{'format':'columnar-little-endian-gzip-v1'},'bmrs':[{'id':'mutsig','label':'MutSigCV2','role':'primary'}],
        'methods':{'dialect':{'directions':['ME','CO']},'fisher':{'directions':['ME','CO']},'discover':{'directions':['ME','CO']},'megsa':{'directions':['ME'],'call_rule':'p < 0.001'},'wesme_wesco':{'directions':['ME','CO']}},
        'index_file':'index.json','index_sha256':index_record['sha256'],'index_bytes':index_record['bytes'],
        'readme_file':'README.md','readme_sha256':receipt(output/'README.md')['sha256'],'readme_bytes':receipt(output/'README.md')['bytes'],
        'annotation_file':'likely-passengers.json','annotation_sha256':annotation_record['sha256'],
        'verification_file':'verification.json','verification_sha256':verification_record['sha256'],
        'table_s5_sha256':receipt(output/'TableS5.csv')['sha256']}
    write_json(output / 'manifest.json', manifest)
    print('VERIFIED', output, flush=True)

if __name__ == '__main__':
    main()
