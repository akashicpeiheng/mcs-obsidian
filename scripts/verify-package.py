import hashlib, json, zipfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
latest = json.loads((root / 'release/latest.json').read_text(encoding='utf-8'))
release, archive = Path(latest['release']), Path(latest['archive'])
checks = json.loads((release / 'CHECKSUMS.json').read_text(encoding='utf-8'))
sha = lambda data: hashlib.sha256(data).hexdigest()
assert sha(archive.read_bytes()) == checks['archiveSha256']
manifest = json.loads((release / 'mcs-cognitive-space/manifest.json').read_text(encoding='utf-8'))
expected = {manifest['id'] + '/' + f['file']: f for f in checks['files']}
assert not any('__pycache__' in name or name.endswith('.pyc') for name in expected)
with zipfile.ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    actual = {f.filename.replace('\\', '/'): f for f in bundle.infolist() if not f.is_dir()}
    assert set(actual) == set(expected), (set(actual), set(expected))
    for name, f in actual.items():
        data = bundle.read(f)
        assert len(data) == expected[name]['size']
        assert sha(data) == expected[name]['sha256']
for f in checks['payloadFiles']:
    assert sha((release / f['file']).read_bytes()) == f['sha256']
validation = json.loads((release / 'docs/validation/desktop.json').read_text(encoding='utf-8'))
# 版本只在插件清单里写一次；验收记录必须与清单一致，脚本本身不写死版本号。
assert validation['version'] == manifest['version'], (validation['version'], manifest['version'])
assert validation['theme']['status'] == 'passed' and len(validation['theme']['checks']) >= 10
assert validation['witness']['status'] == 'passed' and len(validation['witness']['checks']) >= 10
assert validation['witness']['artifactSha256'] == validation['artifactSha256']
assert validation['renderer']['status'] == 'passed' and validation['renderer']['fitClearsControls']
assert validation['renderer']['p95FrameMs'] <= 33
# 性能、稳定性与宿主兼容也必须在安装包里留下可复核的记录。
assert validation['perf']['status'] == 'passed' and len(validation['perf']['runs']) >= 10
assert validation['perf']['artifactSha256'] == validation['artifactSha256']
assert validation['soak']['status'] == 'passed' and len(validation['soak']['cycles']) >= 4
assert validation['soak']['artifactSha256'] == validation['artifactSha256']
assert validation['compat']['minAppVersion'] == manifest['minAppVersion']
assert validation['compat']['importedTooNew'] == []
for f in validation['artifacts']:
    if f['file'].startswith('dist/'):
        assert sha((release / manifest['id'] / f['file'][5:]).read_bytes()) == f['sha256']
for name in ['calculation', 'structure', 'book-map']:
    example = json.loads((release / f'examples/{name}.mcspack.json').read_text(encoding='utf-8'))
    assert example['schema'] == 'mcs-bundle/2' and example['view']['schema'] == 'mcs-view/2'
    assert example['view']['display']['nodeMode'] == 'adaptive'
    assert example['content']['version'] == validation['desktop']['contentVersion']
    assert len(example['view']['formalSources']) >= 1
    assert {r['formal']['witness']['mode'] for r in example['view']['relations']} == {'reference', 'instantiate', 'finite'}
assert (release / 'docs/dynamic-demo.gif').read_bytes()[:6] in [b'GIF89a', b'GIF87a']
print(json.dumps({'status':'passed','archiveFiles':len(expected),'payloadFiles':len(checks['payloadFiles']),'archiveSha256':checks['archiveSha256'],'testedBuildMatchesPackage':True}, indent=2))
