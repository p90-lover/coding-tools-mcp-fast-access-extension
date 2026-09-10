"""Publish the already verified paired ZIP; preserve main, files and prior releases."""
from pathlib import Path
import hashlib,json,os,shutil,subprocess,zipfile
REPO='p90-lover/coding-tools-mcp-fast-access-extension';DESKTOP='p90-lover/coding-tools-mcp'
SOURCE='b0d4db553227fa3c7300050b8edff6e2eb9afee4';BASE='df23b6719c54acd759a44c5d6e3d3ad312702871'
DESKTOP_SOURCE='9c749e1eb7030c25a6f84cc81e4719b6e01bef7d';TAG='v0.0.7';DESKTOP_TAG='v0.4.3-rc.3'
assert os.environ['GITHUB_REPOSITORY']==REPO

def api(path,body=None,method=None,repo=REPO):
    args=['gh','api',f'repos/{repo}/{path}'];data=None
    if body is not None:args+=['--method',method or 'POST','--input','-'];data=json.dumps(body).encode()
    return json.loads(subprocess.check_output(args,input=data,timeout=90))
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
assert not api('git/matching-refs/tags/'+TAG),'Do not replace an existing release'
assert api('git/ref/heads/main')['object']['sha']==BASE,'Concurrent main changes must be reconciled'
assert api('git/ref/heads/fix/desktop-rc3-compat-0.0.7')['object']['sha']==SOURCE
published=api('releases/tags/'+DESKTOP_TAG,repo=DESKTOP)
assert not published['draft'] and published['published_at']
assert api('git/ref/tags/'+DESKTOP_TAG,repo=DESKTOP)['object']['sha']==DESKTOP_SOURCE
root=Path('aiTemp/paired-publication');root.mkdir(parents=True,exist_ok=False)
name='coding-tools-mcp-extension-v0.0.7.zip'
subprocess.run(['gh','release','download',DESKTOP_TAG,'--repo',DESKTOP,'--pattern',name,'--pattern','provenance.json','--dir',str(root/'desktop')],check=True,timeout=120)
pair=json.loads((root/'desktop/provenance.json').read_text())
assert pair['source_commit']==DESKTOP_SOURCE and pair['extension']['source_commit']==SOURCE
ext=pair['extension'];browser=pair['browser']
assert ext['version']=='0.0.7' and ext['focused_groups_passed']==4 and ext['model_requests']==0
assert ext['profile_contract_checked'] and ext['actual_form_replay_passed']
assert browser['passed'] and browser['extension_helper_replayed'] and browser['extension_source']==SOURCE
assert browser['source']==DESKTOP_SOURCE and not browser['live_chatgpt_account']
archive=root/'desktop'/name
assert digest(archive)==ext['sha256'] and archive.stat().st_size==ext['size']
with zipfile.ZipFile(archive) as z:
    for path,sha in ext['files'].items():
        assert hashlib.sha256(z.read(path)).hexdigest()==sha,path
    assert json.loads(z.read('manifest.json'))['version']=='0.0.7'
    notes=z.read('RELEASE_NOTES.md').decode().split('## Earlier release documentation / 過往版本文件')[0]
assets=root/'assets';assets.mkdir();shutil.copy2(archive,assets/name)
provenance={'version':'0.0.7','source_commit':SOURCE,'desktop_release':published['html_url'],'desktop_source':DESKTOP_SOURCE,
    'desktop_workflow_run':pair['workflow_run'],'extension':ext,'browser':browser,'byte_identical_to_desktop_release':True,
    'model_requests':0,'live_account_verified':False}
(assets/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
(assets/'SHA256SUMS.txt').write_text(''.join(f'{digest(p)}  {p.name}\n' for p in sorted(assets.iterdir())))
files=sorted(assets.iterdir());assert len(files)==3
notes+=f'\n\nPaired Desktop / 配對 Desktop: {published["html_url"]}\nSource / 原始碼: `{SOURCE}`\n'
release=api('releases',{'tag_name':TAG,'target_commitish':SOURCE,'name':'coding-tools-mcp Extension v0.0.7 — verified Desktop pair','body':notes,'draft':True,'prerelease':True,'make_latest':'false'})
Path('aiTemp/paired-release-draft.json').write_text(json.dumps({'id':release['id'],'source':SOURCE,'tag':TAG}))
for p in files:subprocess.run(['gh','release','upload',TAG,str(p),'--repo',REPO],check=True,timeout=120)
readback=root/'readback';readback.mkdir()
subprocess.run(['gh','release','download',TAG,'--repo',REPO,'--dir',str(readback)],check=True,timeout=120)
assert {p.name for p in readback.iterdir()}=={p.name for p in files}
for p in files:assert digest(readback/p.name)==digest(p),p.name
assert api('git/ref/heads/main')['object']['sha']==BASE
api('git/refs/heads/main',{'sha':SOURCE,'force':False},'PATCH')
refs=api('git/matching-refs/tags/'+TAG)
if not refs:api('git/refs',{'ref':'refs/tags/'+TAG,'sha':SOURCE})
else:assert len(refs)==1 and refs[0]['object']['sha']==SOURCE
public=api('releases/'+str(release['id']),{'draft':False,'prerelease':True,'make_latest':'false'},'PATCH')
assert not public['draft'] and public['published_at']
assert api('git/ref/tags/'+TAG)['object']['sha']==SOURCE and api('git/ref/heads/main')['object']['sha']==SOURCE
receipt={'release_url':public['html_url'],'source_commit':SOURCE,'main_updated':True,'paired_desktop_source':DESKTOP_SOURCE,
    'verified_uploaded_bytes':True,'assets':[{'name':p.name,'sha256':digest(p),'size':p.stat().st_size} for p in files]}
Path('aiTemp/paired-release-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt,indent=2))
