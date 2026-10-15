"""Export the plugin and a hashed, minimal snapshot of its MCS dependencies.

Run from the maintainer workspace. Never overwrite a previous export.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import zipfile

ROOT = Path(__file__).resolve().parent.parent
WORKSPACE = ROOT.parent
IMPORTS = re.compile(r"(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)(['\"])([^'\"]+)\1")
CODE = {'.mjs', '.js', '.cjs', '.ts', '.tsx'}
TEXT = CODE | {'.json', '.md', '.css', '.html', '.py', '.txt', '.yml', '.yaml', '.lean'}
SKIP = {'node_modules', 'dist', 'runtime', 'preview', '__pycache__', '.git'}
SECRETS = [r'-----BEGIN [A-Z ]*PRIVATE KEY-----', r'\bgh[pousr]_[A-Za-z0-9]{20,}\b',
           r'\bsk-[A-Za-z0-9_-]{24,}\b', r'\bAKIA[0-9A-Z]{16}\b',
           r'C:\\Users\\[^\\\s"\']+', r'\\AppData\\']


def sha(data):
    return hashlib.sha256(data).hexdigest()


def safe_copy(source, target):
    if source.is_symlink() or source.is_junction():
        raise ValueError(f'Refusing a link: {source.name}')
    if source.is_dir():
        for child in source.iterdir():
            if child.name in SKIP or child.suffix in {'.pyc', '.tsbuildinfo'}:
                continue
            if child.name == 'latest.json' and child.parent.name == 'release':
                continue
            safe_copy(child, target / child.name)
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)


def resolve_import(source, spec):
    base = source.parent / spec
    for item in [base, *[Path(str(base) + ext) for ext in ['.ts', '.tsx', '.mjs', '.js', '.json']], base / 'index.ts']:
        if item.is_file():
            return item.resolve()
    raise ValueError(f'Cannot resolve {spec} from {source.relative_to(WORKSPACE)}')


def export(out, website_commit):
    if out.exists():
        raise ValueError('Output must not already exist')
    if out.is_relative_to(ROOT):
        raise ValueError('Output must be outside the plugin source tree')
    if not (WORKSPACE / 'mcs-web/core/planner.mjs').is_file():
        raise ValueError('Run this exporter from the MCS maintainer workspace')
    out.mkdir(parents=True)
    for name in ['assets', 'data', 'docs', 'examples', 'proofs', 'release', 'scripts', 'src', 'tests',
                 'manifest.json', 'package.json', 'package-lock.json', 'tsconfig.json', 'README.md',
                 '.gitignore', '.gitattributes', 'LICENSE-MIT', 'LICENSE-CONTENT', 'NOTICE', 'SECURITY.md']:
        safe_copy(ROOT / name, out / name)

    pending = {WORKSPACE / p for p in [
        'mcs-web/data/cases/jiang.mjs', 'mcs-web/core/planner.mjs',
        'mcs-web/web/src/network.ts', 'mcs-web/web/src/network-order.ts',
        'mcs-web/web/src/node-placement.ts', 'mcs-foundations/06-硬关系.md',
        'mcs-foundations/12-视图转换与路径规划.md',
        'mcs-foundations/validation/certification/kernel.py']}
    for folder in ['src', 'scripts', 'tests']:
        for file in (ROOT / folder).rglob('*'):
            if file.suffix not in CODE:
                continue
            for match in IMPORTS.finditer(file.read_text(encoding='utf-8')):
                spec = match[2]
                if spec.startswith('../../mcs-') and '/node_modules/' not in spec:
                    pending.add(resolve_import(file, spec))

    copied = {}
    while pending:
        source = pending.pop().resolve()
        relative = source.relative_to(WORKSPACE)
        if relative.parts[0] not in {'mcs-web', 'mcs-foundations'} or any(part in SKIP for part in relative.parts):
            raise ValueError(f'Unexpected upstream dependency: {relative}')
        if relative.as_posix() in copied:
            continue
        safe_copy(source, out / 'upstream' / relative)
        copied[relative.as_posix()] = sha(source.read_bytes())
        if source.suffix in CODE:
            for match in IMPORTS.finditer(source.read_text(encoding='utf-8')):
                if match[2].startswith('.'):
                    pending.add(resolve_import(source, match[2]))

    for folder in ['src', 'scripts', 'tests']:
        for file in (out / folder).rglob('*'):
            if file.suffix not in CODE or file.name == Path(__file__).name:
                continue
            text = file.read_text(encoding='utf-8')
            text = text.replace('../../mcs-web/node_modules/playwright-core/index.mjs', 'playwright-core')
            text = text.replace('../../mcs-web/', '../upstream/mcs-web/')
            text = text.replace('../../mcs-foundations/', '../upstream/mcs-foundations/')
            text = text.replace('`../../${path}`', '`../upstream/${path}`')
            file.write_text(text, encoding='utf-8', newline='')
    package = json.loads((out / 'package.json').read_text(encoding='utf-8'))
    package['devDependencies']['playwright-core'] = '1.63.0'
    (out / 'package.json').write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    provenance = {'schema': 'mcs-plugin-upstream/1', 'repository': 'https://github.com/akashicpeiheng/math-cognitive-space',
                  'relatedWebsiteCommit': website_commit,
                  'origin': 'MCS maintainer workspace; per-file hashes identify this snapshot, including two theory chapters outside the website export.',
                  'files': dict(sorted(copied.items()))}
    (out / 'upstream/SOURCES.json').write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    readme = (out / 'README.md').read_text(encoding='utf-8')
    readme = readme.replace('源码构建复用相邻 `mcs-web` 的规划、形式语言、搜索、增量摆位与布局模块；构建结果已经打包这些模块，安装后不依赖相邻仓库。',
        '源码构建复用 `upstream/` 中的 MCS 共享模块快照，单独克隆本仓库即可构建。来源提交与逐文件 SHA-256 见 `upstream/SOURCES.json`；快照中的代码与原创理论分别沿用 MIT 与 CC BY 4.0。更新共享模块时，在主工作区重新导出。')
    readme = readme.replace('cd E:\\MCS\\mcs-obsidian', 'git clone https://github.com/akashicpeiheng/mcs-obsidian.git\ncd mcs-obsidian')
    (out / 'README.md').write_text(readme, encoding='utf-8')

    deny_path = WORKSPACE / 'design/release-deny-list.json'
    if not deny_path.is_file():
        raise ValueError('Maintainer disclosure rules are missing')
    deny = [item['pattern'] for item in json.loads(deny_path.read_text(encoding='utf-8'))['blocking']]
    patterns = [re.compile(p) for p in SECRETS + deny]
    scanned = 0
    for file in out.rglob('*'):
        if not file.is_file() or file == out / 'scripts' / Path(__file__).name:
            continue
        payloads = []
        if file.suffix in TEXT or file.name in {'NOTICE', 'LICENSE-MIT', 'LICENSE-CONTENT'}:
            payloads.append((file.relative_to(out).as_posix(), file.read_bytes()))
        elif file.suffix == '.zip':
            with zipfile.ZipFile(file) as archive:
                for entry in archive.infolist():
                    name = entry.filename.replace('\\', '/')
                    if name.startswith('/') or '..' in Path(name).parts or any(p in SKIP for p in Path(name).parts):
                        raise ValueError(f'Unexpected archive path: {file.name}')
                    if Path(name).suffix in TEXT:
                        payloads.append((file.relative_to(out).as_posix() + ':' + name, archive.read(entry)))
        for name, data in payloads:
            scanned += 1
            if any(pattern.search(data.decode('utf-8', errors='replace')) for pattern in patterns):
                raise ValueError(f'Publication scan failed: {name}')
    report = {'status': 'passed', 'upstreamFiles': len(copied), 'scannedTextFiles': scanned,
              'disclosuresChecked': True, 'websiteCommit': website_commit}
    out.with_suffix('.export-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--website-commit', required=True)
    args = parser.parse_args()
    export(args.out.resolve(), args.website_commit)
