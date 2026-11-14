#!/usr/bin/env python3
"""Package maintenance source and optional authoring fixtures, never signing secrets."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def safe_files(directory):
    return [p for p in directory.rglob('*') if p.is_file() and '__pycache__' not in p.parts and not p.is_symlink()]

def main():
    version = json.loads((ROOT/'HANDOFF.json').read_text())['release']['versionName']
    output = ROOT/'dist/handoff'
    output.mkdir(parents=True, exist_ok=True)
    source = output/f'StorySpot-{version}-source.zip'
    media = output/f'StorySpot-{version}-authoring-media.zip'
    selected = [ROOT/name for name in ['README.md','AGENTS.md','HANDOFF.json','package.json','package-lock.json','requirements-dev.txt','.gitignore']]
    for directory in ['web','android','tools','docs','tests']:
        selected += safe_files(ROOT/directory)
    selected += [p for p in safe_files(ROOT/'production') if p.suffix=='.json']
    # The delivered binary and its public verification evidence are a baseline,
    # never a source of signing secrets.
    release_names = [f'StorySpot-{version}{suffix}' for suffix in ['.apk','.apk.json','.apk.sha256']]
    release_names += [f'verification-{version}.json']
    # A restored handoff keeps its baseline under release/. New builds go in
    # dist/; use those when present without requiring manual file relocation.
    release = [next((directory/name for directory in [ROOT/'dist',ROOT/'release'] if (directory/name).is_file()), ROOT/'dist'/name) for name in release_names]
    for p in selected+release:
        if not p.is_file() or p.suffix.lower() in {'.p12','.jks','.keystore'} or 'password' in p.name.lower():
            raise RuntimeError(f'Unsafe/missing handoff input: {p}')
    source_hashes = []
    with zipfile.ZipFile(source,'w',zipfile.ZIP_DEFLATED) as archive:
        for p in sorted(set(selected)):
            name='StorySpot/'+p.relative_to(ROOT).as_posix()
            archive.write(p,name)
            source_hashes.append(f'{digest(p)}  {name}')
        for p in release:
            name='StorySpot/release/'+p.name
            archive.write(p,name)
            source_hashes.append(f'{digest(p)}  {name}')
        archive.writestr('StorySpot/SOURCE_FILES.sha256','\n'.join(source_hashes)+'\n')
    media_files=safe_files(ROOT/'production/remote-library/content')
    with zipfile.ZipFile(media,'w',zipfile.ZIP_DEFLATED) as archive:
        for p in sorted(media_files):
            archive.write(p,p.relative_to(ROOT).as_posix())
        archive.writestr('AUTHORING_MEDIA.sha256','\n'.join(f'{digest(p)}  {p.relative_to(ROOT).as_posix()}' for p in sorted(media_files))+'\n')
    for p in [source,media]:
        with zipfile.ZipFile(p) as archive:
            assert archive.testzip() is None
        print(json.dumps({'file':p.name,'bytes':p.stat().st_size,'sha256':digest(p)}))
    (output/'SHA256SUMS.txt').write_text('\n'.join(f'{digest(p)}  {p.name}' for p in [source,media])+'\n')

if __name__=='__main__':
    main()
