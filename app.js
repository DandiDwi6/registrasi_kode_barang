/* ================= konfigurasi ================= */
const BASE_CATS={TST:'Alat Test',MEK:'Mekanikal',ELC:'Electrical'};
const KONDISI=['Baik','Perlu kalibrasi','Perlu perbaikan','Rusak'];
const BU='HV';
const LS='kode-barang-v1',LSC='kode-barang-cats-v1';
const SOON=30; // hari: batas peringatan kalibrasi
const $=id=>document.getElementById(id);

const CATS={};
Object.entries(BASE_CATS).forEach(([k,n])=>CATS[k]={n});
let cat='TST',items=[],col=null,lastItem=null,editing=null,dlgKode=null;
const sel=new Set();let visible=[]; // sel = kode yang dicentang, visible = kode pada tabel saat ini
const LSQ='kode-barang-qr-v1';
let qrMode='link',qrBase='',loaded=false; // loaded = data sudah selesai dimuat

/* ================= util ================= */
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const fmt=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const today=()=>fmt(new Date());
const isDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'');
const parseD=s=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||'');return m?new Date(+m[1],+m[2]-1,+m[3]):null};
const daysTo=s=>{const d=parseD(s);return d?Math.round((d-parseD(today()))/864e5):null};
const fmtID=s=>{const d=parseD(s);return d?d.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}):''};
function addMonths(s,n){
  const d=parseD(s);if(!d||!(n>0))return '';
  const day=d.getDate();let r=new Date(d.getFullYear(),d.getMonth()+n,day);
  if(r.getDate()!==day)r=new Date(d.getFullYear(),d.getMonth()+n+1,0); // 31 Jan + 1 bln = 28/29 Feb
  return fmt(r);
}
const msg=(t,er)=>{const m=$('msg');m.textContent=t;m.style.color=er?'var(--er)':'var(--ok)'};
const persist=()=>localStorage.setItem(LS,JSON.stringify(items));

/* ================= backend Google Sheets (Apps Script) ================= */
const CFG=window.CONFIG||{};
const API=(CFG.URL&&CFG.TOKEN&&/^https:\/\/script\.google\.com\//.test(CFG.URL)&&!/GANTI/.test(CFG.TOKEN))?CFG:null;
async function api(body){ // POST sebagai text/plain agar tidak memicu preflight CORS
  const r=await fetch(API.URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(Object.assign({token:API.TOKEN},body))});
  const j=await r.json();
  if(!j.ok)throw new Error(j.error||'Permintaan gagal');
  return j;
}
async function refresh(){
  const r=await fetch(API.URL+'?action=list&token='+encodeURIComponent(API.TOKEN)),j=await r.json();
  if(!j.ok)throw new Error(j.error||'Gagal memuat');
  (j.cats||[]).forEach(c=>{if(/^[A-Z0-9]{2,4}$/.test(c.kode)&&!CATS[c.kode])CATS[c.kode]={n:c.nama,custom:true}});
  items=j.items||[];
  delete $('stat').dataset.lock;
  if(lastItem)lastItem=items.find(i=>i.kode===lastItem.kode)||null;
  saveCustomCats();render();drawCats();drawFilter();
}
const catName=k=>CATS[k]?.n||k;
$('tgl').value=today();

/* ================= klasifikasi (bisa tambah manual) ================= */
function loadCustomCats(){
  try{
    const o=JSON.parse(localStorage.getItem(LSC)||'{}');
    Object.entries(o).forEach(([k,n])=>{if(/^[A-Z0-9]{2,4}$/.test(k)&&!CATS[k]&&typeof n==='string'&&n)CATS[k]={n,custom:true}});
  }catch(e){}
}
function saveCustomCats(){
  const o={};Object.entries(CATS).forEach(([k,v])=>{if(v.custom)o[k]=v.n});
  try{localStorage.setItem(LSC,JSON.stringify(o))}catch(e){}
}
// klasifikasi yang dipakai barang (mis. dari database bersama) otomatis ikut muncul
function syncCats(){
  let ch=false;
  items.forEach(i=>{if(i.kat&&!CATS[i.kat]){CATS[i.kat]={n:i.katNama||i.kat,custom:true};ch=true}});
  if(ch){saveCustomCats();drawCats();drawFilter()}
}
function drawFilter(){
  const v=$('fkat').value;
  $('fkat').innerHTML='<option value="">Semua klasifikasi</option>'+Object.entries(CATS).map(([k,c])=>`<option value="${k}">${esc(c.n)}</option>`).join('');
  $('fkat').value=CATS[v]?v:'';
}
function drawCats(){
  $('cats').innerHTML=Object.entries(CATS).map(([k,v])=>`<button type="button" class="cat ${k===cat?'on':''}" data-k="${k}"${editing?' disabled':''}><b>${esc(v.n)}</b><small>${BU}-${k}-…</small></button>`).join('')
    +`<button type="button" class="cat add" data-add="1"${editing?' disabled':''}><b>+</b><small>Tambah klasifikasi</small></button>`;
  $('cats').querySelectorAll('.cat').forEach(b=>b.onclick=()=>{
    if(b.dataset.add){toggleAdd(true);return}
    cat=b.dataset.k;drawCats();showNext();
  });
  const c=CATS[cat];
  $('catDel').hidden=!(c&&c.custom&&!editing&&!items.some(i=>i.kat===cat));
}
function toggleAdd(show){
  $('catAdd').hidden=!show;
  if(show){$('ncKode').value='';$('ncNama').value='';$('ncKode').focus()}
}
async function addCat(){
  const k=$('ncKode').value.trim().toUpperCase(),n=$('ncNama').value.trim();
  if(!/^[A-Z0-9]{2,4}$/.test(k)){msg('Kode klasifikasi harus 2–4 huruf/angka, tanpa spasi atau tanda baca.',1);return}
  if(CATS[k]){msg('Kode "'+k+'" sudah dipakai oleh '+CATS[k].n+'.',1);return}
  if(!n){msg('Nama klasifikasi wajib diisi.',1);return}
  if(Object.values(CATS).some(v=>v.n.toLowerCase()===n.toLowerCase())){msg('Nama klasifikasi "'+n+'" sudah ada.',1);return}
  if(API){try{await api({action:'saveCat',kode:k,nama:n})}catch(e){msg(e.message||'Gagal menyimpan klasifikasi',1);return}}
  CATS[k]={n,custom:true};saveCustomCats();
  cat=k;toggleAdd(false);drawCats();drawFilter();showNext();
  msg('Klasifikasi ditambahkan: '+n+' ('+k+')');
}
$('ncOk').onclick=addCat;
$('ncBatal').onclick=()=>toggleAdd(false);
$('ncKode').oninput=e=>{e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'')};
$('ncNama').onkeydown=$('ncKode').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();addCat()}};
$('catDel').onclick=async()=>{
  const c=CATS[cat];if(!c||!c.custom)return;
  if(items.some(i=>i.kat===cat)){msg('Klasifikasi masih dipakai barang.',1);return}
  if(!confirm('Hapus klasifikasi "'+c.n+'" ('+cat+')?'))return;
  if(API){try{await api({action:'deleteCat',kode:cat})}catch(e){msg(e.message||'Gagal menghapus klasifikasi',1);return}}
  delete CATS[cat];saveCustomCats();cat='TST';drawCats();drawFilter();showNext();msg('Klasifikasi dihapus.');
};

/* ================= kode ================= */
function genCode(kat,tgl,list=items){
  const y=(tgl||today()).slice(2,4),pre=`${BU}-${kat}-${y}-`;
  let max=0;
  list.forEach(i=>{if(i.kode&&i.kode.startsWith(pre)){const n=parseInt(i.kode.slice(pre.length),10);if(n>max)max=n}});
  return pre+String(max+1).padStart(4,'0');
}
function showNext(){
  $('nextLbl').textContent=editing?'Kode (tetap)':'Kode berikutnya';
  $('nextCode').textContent=editing||genCode(cat,$('tgl').value);
}

/* ================= status kalibrasi & pinjam ================= */
function kalState(it){
  const n=daysTo(it.kalNext);
  if(n===null)return {k:'',t:'',c:''};
  if(n<0)return {k:'lewat',t:'Lewat '+(-n)+' hari',c:'er'};
  if(n<=SOON)return {k:'segera',t:n===0?'Hari ini':n+' hari lagi',c:'wr'};
  return {k:'ok',t:'OK',c:'ok'};
}
const pinjamLate=i=>!!(i.pinjam&&i.pinjam.rencana&&daysTo(i.pinjam.rencana)<0);
function statusMatch(it,st){
  if(!st)return true;
  if(st==='lewat'||st==='segera')return kalState(it).k===st;
  if(st==='pinjam')return !!it.pinjam;
  if(st==='telat')return pinjamLate(it);
  if(st==='tersedia')return !it.pinjam;
  return true;
}

/* ================= label ================= */
const useQR=()=>typeof qrcode!=='undefined'; // label selalu QR; teks saja jika library QR gagal dimuat
const ascii=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7E\n]/g,'?'); // QR teks: aman untuk semua pembaca
const defaultBase=()=>{try{return /^https?:$/.test(location.protocol)?location.href.replace(/#.*$/,''):''}catch(e){return ''}};
const baseURL=()=>{const b=(qrBase||defaultBase()).trim().replace(/#.*$/,'');return /^https?:\/\/\S+$/i.test(b)?b:''};
function qrPayload(it){
  if(qrMode==='link'){
    const own=/^https?:\/\/\S+$/i.test((qrBase||'').trim())?qrBase.trim().replace(/#.*$/,''):'';
    if(own)return own+'#'+it.kode;                                   // alamat aplikasi yang diisi manual
    if(API)return API.URL+'?kode='+encodeURIComponent(it.kode);      // halaman publik dari Apps Script
    const b=baseURL();if(b)return b+'#'+it.kode;
  }
  const L=[it.kode,catName(it.kat)+' - '+it.nama,
    (it.merk||it.tipe)&&'Merk/Tipe: '+[it.merk,it.tipe].filter(Boolean).join(' / '),
    it.sn&&'S/N: '+it.sn,it.lokasi&&'Lokasi: '+it.lokasi,it.kondisi&&'Kondisi: '+it.kondisi,
    it.kalNext&&'Kalibrasi berikutnya: '+fmtID(it.kalNext),it.kalNo&&'No. sertifikat: '+it.kalNo,it.pic&&'PIC: '+it.pic];
  return ascii(L.filter(Boolean).join('\n')).slice(0,600);
}
function labelHTML(it){
  const head=`<div class="h"><span>ASSET TAG</span><span>${esc(catName(it.kat))}</span></div>`;
  const mk=esc([it.merk,it.tipe].filter(Boolean).join(' / ')),sn=it.sn?' · S/N '+esc(it.sn):'';
  if(useQR())return head+`<div class="q"><div class="qr"></div><div class="qd"><div class="c">${esc(it.kode)}</div><b>${esc(it.nama)}</b><span>${mk}${sn}</span><span>Lokasi: ${esc(it.lokasi||'-')}</span><span>Reg: ${esc(it.tgl||'')}</span></div></div>`;
  return head+`<div class="c">${esc(it.kode)}</div>
  <div class="d"><b>${esc(it.nama)}</b><br>${mk}${sn}<br>Lokasi: ${esc(it.lokasi||'-')} · Reg: ${esc(it.tgl||'')}</div>`;
}
function drawCode(root,it){
  const kode=it.kode;
  if(useQR()){
    const box=root.querySelector('.qr');
    try{
      let q;
      try{q=qrcode(0,'M');q.addData(qrPayload(it));q.make()}
      catch(e){q=qrcode(0,'M');q.addData(kode);q.make()} // isi terlalu panjang -> kode saja
      box.innerHTML=q.createSvgTag(4,0);
      const s=box.querySelector('svg');
      if(!s.getAttribute('viewBox'))s.setAttribute('viewBox','0 0 '+parseFloat(s.getAttribute('width'))+' '+parseFloat(s.getAttribute('height')));
      s.removeAttribute('width');s.removeAttribute('height');
      s.setAttribute('preserveAspectRatio','xMidYMid meet');
    }catch(e){}
  }
}
/* ================= ukuran label ================= */
const LSS='kode-barang-size-v1';
const A4W=190,A4H=277; // area cetak A4 setelah margin 10 mm
function fitLabel(){ // perkecil preview agar muat di layar sempit (hasil cetak tidak terpengaruh)
  const L=$('label'),box=L.parentElement;
  L.style.zoom='';
  const avail=box.clientWidth-28,w=L.offsetWidth;
  if(avail>0&&w>avail)L.style.zoom=(avail/w).toFixed(3);
}
window.addEventListener('resize',fitLabel);
function applySize(save){
  let v=$('lblSize').value,w,h;
  if(v==='custom'){w=+$('lblW').value||60;h=+$('lblH').value||40}
  else{[w,h]=v.split('x').map(Number)}
  w=Math.min(150,Math.max(20,w));h=Math.min(100,Math.max(15,h));
  $('lblCustom').hidden=v!=='custom';
  const mode=w<45?'mini':(h<35||w<60?'cmp':'');
  const k=mode==='mini'?1:Math.min(1.6,Math.max(.7,Math.min(w/75,h/45)));
  let qr,cf;
  if(mode==='mini'){
    qr=Math.max(8,Math.min(w-2,h-2-4));
    cf=Math.min(8,(w-2)/9.6*2.835*.97);
  }else{
    qr=Math.max(8,mode==='cmp'?Math.min(h-4,w*.42):Math.min(h*.62,w*.4));
    cf=Math.min(10.5*k,Math.max(5,(w-6*k-qr-2.5*k)/9.6*2.835*.97));
  }
  const gx=w<60?3:5,gy=1;
  const cols=Math.max(1,Math.floor((A4W+gx)/(w+gx))),rows=Math.max(1,Math.floor((A4H+gy)/(h+gy)));
  PER_SHEET=cols*rows;
  const s=document.documentElement.style,f=n=>(+n.toFixed(2));
  s.setProperty('--lw',f(w)+'mm');s.setProperty('--lh',f(h)+'mm');s.setProperty('--k',f(k));
  s.setProperty('--qr',f(qr)+'mm');s.setProperty('--cf',f(cf)+'pt');
  s.setProperty('--cols',cols);s.setProperty('--gx',gx+'mm');s.setProperty('--gy',gy+'mm');
  document.documentElement.dataset.lsz=mode;
  $('lblDim').textContent=f(w)+' × '+f(h)+' mm';
  $('perSheet').textContent=PER_SHEET+' label / lembar A4';
  fitLabel();
  if(save){try{localStorage.setItem(LSS,JSON.stringify({v,w:$('lblW').value,h:$('lblH').value}))}catch(e){}}
}
function loadSize(){
  try{
    const o=JSON.parse(localStorage.getItem(LSS)||'null');
    if(o){if([...$('lblSize').options].some(x=>x.value===o.v))$('lblSize').value=o.v;if(o.w)$('lblW').value=o.w;if(o.h)$('lblH').value=o.h}
  }catch(e){}
  applySize(false);
}
$('lblSize').onchange=()=>applySize(true);
$('lblW').oninput=$('lblH').oninput=()=>applySize(true);

function label(it){
  const L=$('label');
  if(!it){L.innerHTML='<div class="empty" style="margin:auto;color:#666">Label muncul setelah barang disimpan</div>';return}
  L.innerHTML=labelHTML(it);
  drawCode(L,it);
  $('copies').value=Math.min(99,Math.max(1,it.qty||1));
}
let PER_SHEET=12; // diatur ulang oleh applySize()
function printBatch(list){ // list: [{it, n}]
  const total=list.reduce((a,x)=>a+x.n,0);
  if(!total)return;
  if(total>200&&!confirm('Akan mencetak '+total+' label. Lanjutkan?'))return;
  const pa=$('printArea');pa.innerHTML='';
  let sheet=null,count=0;
  list.forEach(({it,n})=>{for(let i=0;i<n;i++){
    if(count%PER_SHEET===0){sheet=document.createElement('div');sheet.className='sheet';pa.appendChild(sheet)}
    const d=document.createElement('div');d.className='lbl';d.innerHTML=labelHTML(it);sheet.appendChild(d);drawCode(d,it);count++;
  }});
  window.print();
}
function printLabels(){
  if(!lastItem){msg('Simpan barang dulu atau pilih "Label" dari tabel.',1);return}
  printBatch([{it:lastItem,n:Math.min(99,Math.max(1,parseInt($('copies').value,10)||1))}]);
}
function printSelected(){
  const per=$('bulkN').value;
  const list=items.filter(i=>sel.has(i.kode)).sort((a,b)=>a.kode.localeCompare(b.kode))
    .map(it=>({it,n:per==='qty'?Math.min(99,Math.max(1,it.qty||1)):1}));
  if(!list.length){msg('Centang barang di tabel dulu.',1);return}
  printBatch(list);
}
function updateBulk(){
  $('bulkPrint').textContent='Cetak label terpilih ('+sel.size+')';
  $('bulkPrint').disabled=!sel.size;
  $('selAll').checked=visible.length>0&&visible.every(k=>sel.has(k));
  $('selAllM').checked=$('selAll').checked;$('selAllMt').textContent='Pilih semua hasil ('+visible.length+')';
}
window.addEventListener('afterprint',()=>{$('printArea').innerHTML=''});

/* ================= simpan ke penyimpanan ================= */
async function commit(it){
  let saved=it;
  if(API){
    const exists=items.some(x=>x.kode===it.kode);
    saved=(await api({action:exists?'update':'create',item:it})).item; // kode baru dibuat oleh server
    const k=items.findIndex(x=>x.kode===saved.kode);
    if(k>=0)items[k]=saved;else items.push(saved);
  }else{
    const k=items.findIndex(x=>x.kode===it.kode);if(k>=0)items[k]=it;else items.push(it);persist();
  }
  lastItem=saved;
  render();
  return saved;
}

/* ================= tabel ================= */
function alerts(){
  const c={lewat:0,segera:0,telat:0,pinjam:0};
  items.forEach(i=>{const k=kalState(i).k;if(k==='lewat')c.lewat++;if(k==='segera')c.segera++;if(i.pinjam){c.pinjam++;if(pinjamLate(i))c.telat++}});
  const defs=[['lewat','er','Kalibrasi lewat'],['segera','wr','Kalibrasi ≤ '+SOON+' hari'],['telat','er','Telat kembali'],['pinjam','','Sedang dipinjam']];
  $('alerts').innerHTML=defs.filter(d=>c[d[0]]).map(d=>`<button type="button" class="chip ${d[1]}" data-s="${d[0]}">${d[2]}: <b>${c[d[0]]}</b></button>`).join('');
}
$('alerts').onclick=e=>{const b=e.target.closest('.chip');if(!b)return;$('fstat').value=$('fstat').value===b.dataset.s?'':b.dataset.s;render()};

const SUMDEF={
  baik:['Barang kondisi Baik',i=>i.kondisi==='Baik'],
  kal:['Barang perlu kalibrasi',i=>i.kondisi==='Perlu kalibrasi'],
  perb:['Barang perlu perbaikan',i=>i.kondisi==='Perlu perbaikan'],
  rusak:['Barang rusak',i=>i.kondisi==='Rusak'],
  pinjam:['Barang sedang dipinjam',i=>!!i.pinjam],
  tsd:['Barang tersedia',i=>!i.pinjam]
};
function showList(key){
  const d=SUMDEF[key];if(!d)return;
  const list=items.filter(d[1]).sort((a,b)=>a.kode.localeCompare(b.kode));
  $('lsTitle').textContent=d[0]+' ('+list.length+')';
  $('lsBody').innerHTML=list.length?list.map(i=>{
    const sub=[i.lokasi&&'Lokasi: '+i.lokasi,i.pinjam&&'Dipinjam: '+i.pinjam.oleh].filter(Boolean).join(' · ');
    return `<button type="button" class="lsitem" data-k="${esc(i.kode)}"><code>${esc(i.kode)}</code><b>${esc(i.nama)}</b>${sub?`<small>${esc(sub)}</small>`:''}</button>`;
  }).join(''):'<div class="lsempty">Tidak ada barang.</div>';
  if(!$('dlgList').open)$('dlgList').showModal();
}
$('sum').onclick=e=>{const b=e.target.closest('.sc');if(b)showList(b.dataset.f)};
$('lsBody').onclick=e=>{const b=e.target.closest('.lsitem');if(!b)return;$('dlgList').close();showDetail(b.dataset.k)};
function summary(){
  const c={Baik:0,'Perlu kalibrasi':0,'Perlu perbaikan':0,Rusak:0,pinjam:0};
  items.forEach(i=>{if(c[i.kondisi]!==undefined)c[i.kondisi]++;if(i.pinjam)c.pinjam++});
  $('sBaik').textContent=c.Baik;$('sKal').textContent=c['Perlu kalibrasi'];
  $('sPerb').textContent=c['Perlu perbaikan'];$('sRusak').textContent=c.Rusak;
  $('sPinjam').textContent=c.pinjam;$('sTsd').textContent=items.length-c.pinjam;
  $('sumTot').textContent='Total '+items.length+' barang';
}
const isMob=()=>window.matchMedia('(max-width:700px)').matches;
const PAGE=()=>isMob()?15:50;
let shownN=0,lastSig=null;const expanded=new Set();
function render(){
  syncCats();
  const q=$('cari').value.toLowerCase().trim(),f=$('fkat').value,st=$('fstat').value;
  const list=items.filter(i=>(!f||i.kat===f)&&statusMatch(i,st)&&
      (!q||[i.kode,i.nama,i.sn,i.lokasi,i.merk,i.tipe,i.pinjam&&i.pinjam.oleh,i.pinjam&&i.pinjam.proyek].join(' ').toLowerCase().includes(q)))
    .sort((a,b)=>b.kode.localeCompare(a.kode));
  const sig=q+'|'+f+'|'+st;if(sig!==lastSig){lastSig=sig;shownN=0}
  const lim=Math.max(shownN,PAGE()),part=list.slice(0,lim),rest=list.length-part.length;
  const known=new Set(items.map(i=>i.kode));sel.forEach(k=>{if(!known.has(k))sel.delete(k)});
  visible=list.map(i=>i.kode);
  $('rows').innerHTML=part.map(i=>{
    const ks=kalState(i);
    const kal=ks.k?`<span class="bdg ${ks.c}">${esc(ks.t)}</span> <small>${esc(fmtID(i.kalNext))}</small>`:'<small>-</small>';
    const pj=i.pinjam
      ?`<span class="bdg ${pinjamLate(i)?'er':'wr'}">${pinjamLate(i)?'Telat kembali':'Dipinjam'}</span> <small>${esc(i.pinjam.oleh)}</small>`
      :'<span class="bdg ok">Tersedia</span>';
    const hasHist=i.pinjam||(i.riwayat&&i.riwayat.length);
    const k=esc(i.kode);
    return `<tr class="${lastItem&&lastItem.kode===i.kode?'sel':''}${expanded.has(i.kode)?' open':''}" data-row="${k}"><td><input type="checkbox" class="selr" data-k="${k}"${sel.has(i.kode)?' checked':''} aria-label="Pilih ${k}"></td><td class="code" data-label="Kode"><a href="#${k}" title="Lihat detail">${k}</a></td><td data-label="Klasifikasi">${esc(catName(i.kat))}</td><td data-label="Nama" class="nm">${esc(i.nama)}</td><td data-label="Merk / Tipe">${esc([i.merk,i.tipe].filter(Boolean).join(' / '))}</td><td data-label="S/N">${esc(i.sn)}</td><td data-label="Lokasi">${esc(i.lokasi)}</td><td data-label="Kondisi">${esc(i.kondisi)}</td><td data-label="Kalibrasi">${kal}</td><td data-label="Status">${pj}</td><td data-label="Tgl">${esc(i.tgl)}</td>
    <td class="aksi"><button class="btn sec" data-p="${k}">Label</button> <button class="btn sec" data-e="${k}">Edit</button> ${i.pinjam?`<button class="btn sec" data-k="${k}">Kembalikan</button>`:`<button class="btn sec" data-b="${k}">Pinjam</button>`}${hasHist?` <button class="btn sec" data-r="${k}">Riwayat</button>`:''} <button class="btn dg" data-d="${k}">Hapus</button></td></tr>`;
  }).join('');
  $('empty').hidden=list.length>0;
  $('moreWrap').hidden=rest<=0;
  $('more').textContent='Tampilkan lebih banyak ('+rest+' lagi)';
  $('empty').textContent=items.length?'Tidak ada barang yang cocok dengan filter.':'Belum ada data.';
  if(!$('stat').dataset.lock)$('stat').textContent=items.length+' barang tersimpan'+(col?'':' (lokal browser)');
  alerts();
  summary();
  updateBulk();
  showNext();
}
$('rows').onclick=async e=>{
  const b=e.target.closest('button');if(!b)return;
  const {p,e:ed,b:bw,k:kb,r,d}=b.dataset;
  if(p){lastItem=items.find(i=>i.kode===p);label(lastItem);render();$('label').scrollIntoView({behavior:'smooth',block:'center'})}
  if(ed)startEdit(ed);
  if(bw)openPinjam(bw);
  if(kb)openKembali(kb);
  if(r)showRiwayat(r);
  if(d){
    const it=items.find(i=>i.kode===d);
    const extra=it&&it.pinjam?'\nBarang ini sedang tercatat dipinjam oleh '+it.pinjam.oleh+'.':'';
    if(!confirm('Hapus '+d+' dari database?'+extra))return;
    try{
      if(API)await api({action:'delete',kode:d});
      items=items.filter(i=>i.kode!==d);if(!API)persist();render();
      if(editing===d)endEdit(true);
      if(lastItem&&lastItem.kode===d){lastItem=null;label(null)}
      msg('Dihapus: '+d);
    }catch(err){msg('Gagal menghapus: '+(err&&err.message||'periksa koneksi'),1)}
  }
};

/* ================= form / edit ================= */
const KALF=['kalLast','kalInt','kalNext','kalNo'];
function clearForm(){
  ['nama','merk','tipe','sn','lok','pic','ket',...KALF].forEach(k=>$(k).value='');
  $('qty').value=1;$('kon').value='Baik';$('tgl').value=today();$('kalBox').open=false;
}
function startEdit(kode){
  const it=items.find(i=>i.kode===kode);if(!it)return;
  editing=kode;cat=it.kat;toggleAdd(false);
  $('nama').value=it.nama||'';$('merk').value=it.merk||'';$('tipe').value=it.tipe||'';$('sn').value=it.sn||'';
  $('qty').value=it.qty||1;$('lok').value=it.lokasi||'';$('kon').value=KONDISI.includes(it.kondisi)?it.kondisi:'Baik';
  $('pic').value=it.pic||'';$('tgl').value=it.tgl||today();$('ket').value=it.ket||'';
  $('kalLast').value=it.kalLast||'';$('kalInt').value=it.kalInt||'';$('kalNext').value=it.kalNext||'';$('kalNo').value=it.kalNo||'';
  $('kalBox').open=!!(it.kalLast||it.kalNext||it.kalNo||it.kalInt);
  $('simpan').textContent='Simpan perubahan';$('editkode').textContent=kode;$('editbar').hidden=false;
  drawCats();showNext();msg('');
  $('nama').scrollIntoView({behavior:'smooth',block:'center'});$('nama').focus({preventScroll:true});
}
function endEdit(clear){
  editing=null;$('simpan').textContent='Simpan & buat label';$('editbar').hidden=true;
  if(clear)clearForm();
  drawCats();showNext();
}
$('batal').onclick=()=>{endEdit(true);msg('')};
$('reset').onclick=()=>{endEdit(true);toggleAdd(false);msg('')};

// jadwal kalibrasi berikutnya otomatis = terakhir + interval
function autoNext(){
  const n=addMonths($('kalLast').value,parseInt($('kalInt').value,10));
  if(n)$('kalNext').value=n;
}
$('kalLast').onchange=autoNext;$('kalInt').oninput=autoNext;

$('simpan').onclick=async()=>{
  const nama=$('nama').value.trim();
  if(!nama){msg('Nama barang wajib diisi.',1);$('nama').focus();return}
  const kalLast=$('kalLast').value,kalNext=$('kalNext').value;
  if(kalLast&&kalNext&&kalNext<kalLast){msg('Jadwal kalibrasi berikutnya tidak boleh lebih awal dari kalibrasi terakhir.',1);$('kalBox').open=true;return}
  const sn=$('sn').value.trim();
  if(sn&&items.some(i=>i.kode!==editing&&(i.sn||'').toLowerCase()===sn.toLowerCase())&&
     !confirm('S/N "'+sn+'" sudah terdaftar pada barang lain. Tetap simpan?'))return;
  const tgl=$('tgl').value||today();
  const old=editing?items.find(i=>i.kode===editing):null;
  const kode=editing||genCode(cat,tgl);
  // old di-spread dulu supaya data pinjam & riwayat tidak hilang saat edit
  const it=Object.assign({},old||{},{kode,kat:cat,katNama:catName(cat),nama,merk:$('merk').value.trim(),tipe:$('tipe').value.trim(),sn,
    qty:Math.max(1,parseInt($('qty').value,10)||1),lokasi:$('lok').value.trim(),kondisi:$('kon').value,pic:$('pic').value.trim(),tgl,
    ket:$('ket').value.trim(),kalLast,kalInt:parseInt($('kalInt').value,10)||'',kalNext,kalNo:$('kalNo').value.trim(),
    dibuat:old?.dibuat||Date.now()});
  if(editing)it.diubah=Date.now();
  $('simpan').disabled=true;
  try{
    const saved=await commit(it);
    const wasEdit=!!editing;
    lastItem=saved;
    if(wasEdit)endEdit(true);
    else{['nama','merk','tipe','sn','ket','kalLast','kalNext','kalNo'].forEach(k=>$(k).value='');$('qty').value=1}
    label(saved);render();
    msg((wasEdit?'Diperbarui: ':'Tersimpan: ')+saved.kode);
  }catch(err){msg('Gagal menyimpan: '+(err&&err.message||'hak akses tidak cukup'),1)}
  finally{$('simpan').disabled=false}
};

/* ================= pinjam / kembali / riwayat ================= */
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());

function openPinjam(kode){
  const it=items.find(i=>i.kode===kode);if(!it)return;
  dlgKode=kode;
  $('pjKode').textContent=kode;$('pjNama').textContent=it.nama;
  ['pjOleh','pjProyek','pjRen','pjCat'].forEach(k=>$(k).value='');$('pjTgl').value=today();$('pjErr').textContent='';
  const w=[];
  if(kalState(it).k==='lewat')w.push('Kalibrasi sudah lewat jatuh tempo ('+fmtID(it.kalNext)+').');
  if(it.kondisi&&it.kondisi!=='Baik')w.push('Kondisi barang: '+it.kondisi+'.');
  $('pjWarn').hidden=!w.length;$('pjWarn').textContent=w.join(' ');
  $('dlgPinjam').showModal();$('pjOleh').focus();
}
$('fPinjam').onsubmit=async e=>{
  e.preventDefault();
  const it=items.find(i=>i.kode===dlgKode);if(!it)return;
  const oleh=$('pjOleh').value.trim(),tgl=$('pjTgl').value||today(),rencana=$('pjRen').value;
  if(!oleh){$('pjErr').textContent='Nama peminjam wajib diisi.';return}
  if(rencana&&rencana<tgl){$('pjErr').textContent='Rencana kembali tidak boleh lebih awal dari tanggal pinjam.';return}
  if(!$('pjWarn').hidden&&!confirm('Peringatan: '+$('pjWarn').textContent+'\n\nTetap dipinjamkan?'))return;
  const upd=Object.assign({},it,{pinjam:{oleh,proyek:$('pjProyek').value.trim(),tgl,rencana,cat:$('pjCat').value.trim()}});
  try{await commit(upd);$('dlgPinjam').close();msg('Dipinjamkan: '+it.kode+' → '+oleh)}
  catch(err){$('pjErr').textContent='Gagal menyimpan: '+(err&&err.message||'hak akses tidak cukup')}
};

function openKembali(kode){
  const it=items.find(i=>i.kode===kode);if(!it||!it.pinjam)return;
  dlgKode=kode;
  $('kbKode').textContent=kode;
  $('kbInfo').textContent='Dipinjam oleh '+it.pinjam.oleh+(it.pinjam.proyek?' · '+it.pinjam.proyek:'')+' sejak '+fmtID(it.pinjam.tgl);
  $('kbTgl').value=today();
  $('kbKon').innerHTML=KONDISI.map(k=>`<option>${k}</option>`).join('');
  $('kbKon').value=KONDISI.includes(it.kondisi)?it.kondisi:'Baik';
  $('kbCat').value='';$('kbErr').textContent='';
  $('dlgKembali').showModal();
}
$('fKembali').onsubmit=async e=>{
  e.preventDefault();
  const it=items.find(i=>i.kode===dlgKode);if(!it||!it.pinjam)return;
  const kembali=$('kbTgl').value||today();
  if(kembali<it.pinjam.tgl){$('kbErr').textContent='Tanggal kembali tidak boleh lebih awal dari tanggal pinjam.';return}
  const kondisi=$('kbKon').value;
  const rec=Object.assign({},it.pinjam,{kembali,kondisiKembali:kondisi,catKembali:$('kbCat').value.trim()});
  const upd=Object.assign({},it,{kondisi,riwayat:[...(it.riwayat||[]),rec].slice(-50)});
  delete upd.pinjam; // set() menimpa seluruh dokumen, jadi key pinjam benar-benar hilang
  try{await commit(upd);$('dlgKembali').close();msg('Dikembalikan: '+it.kode)}
  catch(err){$('kbErr').textContent='Gagal menyimpan: '+(err&&err.message||'hak akses tidak cukup')}
};

function showRiwayat(kode){
  const it=items.find(i=>i.kode===kode);if(!it)return;
  $('rwKode').textContent=kode;
  let h='';
  if(it.pinjam){
    const p=it.pinjam;
    h+=`<p><b>Sedang dipinjam:</b> ${esc(p.oleh)}${p.proyek?' · '+esc(p.proyek):''} · sejak ${esc(fmtID(p.tgl))}${p.rencana?' · rencana kembali '+esc(fmtID(p.rencana)):''}</p>`;
  }
  const rows=[...(it.riwayat||[])].reverse();
  h+=rows.length
    ?`<div class="tw"><table><thead><tr><th>Peminjam</th><th>Proyek</th><th>Pinjam</th><th>Kembali</th><th>Kondisi</th><th>Catatan</th></tr></thead><tbody>${
      rows.map(r=>`<tr><td>${esc(r.oleh)}</td><td>${esc(r.proyek)}</td><td>${esc(fmtID(r.tgl))}</td><td>${esc(fmtID(r.kembali))}</td><td>${esc(r.kondisiKembali)}</td><td>${esc([r.cat,r.catKembali].filter(Boolean).join(' / '))}</td></tr>`).join('')
    }</tbody></table></div>`
    :'<p class="hint">Belum ada riwayat pengembalian.</p>';
  $('rwBody').innerHTML=h;
  $('dlgRiwayat').showModal();
}

/* ================= opsi isi QR ================= */
function syncQrOpt(){} // opsi isi QR dihapus dari UI: QR selalu berupa tautan ke halaman barang

/* ================= halaman detail barang (dibuka dari QR / klik kode) ================= */
let dtCur=null;
const KODE_RE=/^[A-Z0-9]{2,6}-[A-Z0-9]{2,4}-\d{2}-\d{3,}$/;
function clearHash(){try{if(location.hash)history.replaceState(null,'',location.pathname+location.search)}catch(e){}}
function openFromHash(){
  let k='';
  try{k=decodeURIComponent(location.hash.slice(1)).trim().toUpperCase()}catch(e){}
  if(!KODE_RE.test(k)||!loaded)return; // jika data belum dimuat, dipanggil lagi setelah selesai dimuat
  showDetail(k);
}
function showDetail(kode){
  const it=items.find(i=>i.kode===kode);
  dtCur=kode;
  $('dtKode').textContent=kode;
  if(!it){
    $('dtBody').innerHTML=`<p>Barang dengan kode <b>${esc(kode)}</b> tidak ditemukan.</p><p class="hint">${col?'Periksa kembali kodenya, atau data belum tersinkron.':'Data aplikasi ini hanya tersimpan di browser ini, jadi barang yang didaftarkan di perangkat lain tidak terlihat. Gunakan database bersama untuk berbagi data antar perangkat.'}</p>`;
    $('dtActs').innerHTML='<button class="btn sec" type="button" data-close="1">Tutup</button>';
  }else{
    const ks=kalState(it),p=it.pinjam,row=(a,b)=>b?`<dt>${a}</dt><dd>${b}</dd>`:'';
    const status=p
      ?`<span class="bdg ${pinjamLate(it)?'er':'wr'}">${pinjamLate(it)?'Telat kembali':'Dipinjam'}</span> ${esc(p.oleh)}${p.proyek?' · '+esc(p.proyek):''}<br><small>sejak ${esc(fmtID(p.tgl))}${p.rencana?' · rencana kembali '+esc(fmtID(p.rencana)):''}</small>`
      :'<span class="bdg ok">Tersedia</span>';
    $('dtBody').innerHTML=`<div class="dtname">${esc(it.nama)}</div><dl class="dl">`
      +row('Klasifikasi',esc(catName(it.kat)))
      +row('Merk / Tipe',esc([it.merk,it.tipe].filter(Boolean).join(' / ')))
      +row('Serial number',esc(it.sn))
      +row('Jumlah',esc(it.qty))
      +row('Lokasi simpan',esc(it.lokasi))
      +row('Kondisi',esc(it.kondisi))
      +row('PIC',esc(it.pic))
      +row('Tgl registrasi',esc(fmtID(it.tgl)))
      +row('Kalibrasi terakhir',esc(fmtID(it.kalLast)))
      +row('Kalibrasi berikutnya',ks.k?`<span class="bdg ${ks.c}">${esc(ks.t)}</span> ${esc(fmtID(it.kalNext))}`:'')
      +row('No. sertifikat',esc(it.kalNo))
      +row('Status',status)
      +row('Keterangan',esc(it.ket))
      +'</dl>';
    $('dtActs').innerHTML=(p?'<button class="btn" type="button" data-act="kembali">Kembalikan</button>':'<button class="btn" type="button" data-act="pinjam">Pinjam</button>')
      +((p||(it.riwayat&&it.riwayat.length))?' <button class="btn sec" type="button" data-act="riwayat">Riwayat</button>':'')
      +' <button class="btn sec" type="button" data-act="edit">Edit</button> <button class="btn sec" type="button" data-close="1">Tutup</button>';
  }
  if(!$('dlgDetail').open)$('dlgDetail').showModal();
}
$('dlgDetail').onclick=e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.close){$('dlgDetail').close();return}
  const a=b.dataset.act,k=dtCur;if(!a)return;
  $('dlgDetail').close();
  if(a==='pinjam')openPinjam(k);
  if(a==='kembali')openKembali(k);
  if(a==='riwayat')showRiwayat(k);
  if(a==='edit')startEdit(k);
};
$('dlgDetail').addEventListener('close',clearHash);
window.addEventListener('hashchange',openFromHash);

/* ================= daftar: buka detail baris (HP) & muat lebih banyak ================= */
$('rows').addEventListener('click',e=>{
  if(!isMob()||e.target.closest('button,a,input,select,label'))return;
  const tr=e.target.closest('tr[data-row]');if(!tr)return;
  const k=tr.dataset.row;
  if(expanded.has(k)){expanded.delete(k);tr.classList.remove('open')}else{expanded.add(k);tr.classList.add('open')}
});
$('more').onclick=()=>{shownN=Math.max(shownN,PAGE())+PAGE();render()};
window.matchMedia('(max-width:700px)').addEventListener('change',()=>{shownN=0;render()});

/* ================= filter & cetak ================= */
$('cetak').onclick=printLabels;
$('bulkPrint').onclick=printSelected;
$('rows').addEventListener('change',e=>{
  const c=e.target.closest('.selr');if(!c)return;
  if(c.checked)sel.add(c.dataset.k);else sel.delete(c.dataset.k);
  updateBulk();
});
$('selAll').onchange=e=>{visible.forEach(k=>{if(e.target.checked)sel.add(k);else sel.delete(k)});render()};
$('selAllM').onchange=$('selAll').onchange;
$('tgl').onchange=showNext;
$('cari').oninput=render;$('fkat').onchange=render;$('fstat').onchange=render;

/* ================= CSV ================= */
const HEAD=['kode','kat','nama','merk','tipe','sn','qty','lokasi','kondisi','pic','tgl','ket','kalLast','kalInt','kalNext','kalNo','pinjamOleh','pinjamProyek','pinjamTgl','pinjamRencana','pinjamCat','riwayat'];
function csvVal(i,k){
  if(k==='kat')return catName(i.kat);
  if(k.startsWith('pinjam'))return i.pinjam?i.pinjam[k.slice(6).toLowerCase()]:'';
  if(k==='riwayat')return i.riwayat&&i.riwayat.length?JSON.stringify(i.riwayat):'';
  return i[k];
}
function parseCSV(text){
  text=text.replace(/^\ufeff/,'');
  const first=text.split(/\r?\n/)[0]||'';
  const dl=(first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?';':','; // Excel Indonesia memakai ;
  const rows=[];let row=[],f='',q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(q){if(c==='"'){if(text[i+1]==='"'){f+='"';i++}else q=false}else f+=c}
    else if(c==='"')q=true;
    else if(c===dl){row.push(f);f=''}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(f);f='';rows.push(row);row=[]}
    else f+=c;
  }
  if(f!==''||row.length){row.push(f);rows.push(row)}
  return rows.filter(r=>r.some(x=>x.trim()!==''));
}
$('csv').onclick=async()=>{
  const q=v=>{let s=String(v??'');if(/^[=+\-@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'}; // cegah formula injection di Excel
  const data='\ufeff'+[HEAD.join(',')].concat(items.map(i=>HEAD.map(k=>q(csvVal(i,k))).join(','))).join('\n');
  const filename='database-kode-barang.csv';
  try{
    const dl=(typeof claude!=='undefined'&&claude.use)?await claude.use('downloads'):null;
    if(dl){await dl.save({filename,data});return}
    const url=URL.createObjectURL(new Blob([data],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=filename;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){msg('Ekspor dibatalkan.',1)}
};
$('csvImp').onclick=()=>$('csvIn').click();
$('csvIn').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  try{
    const rows=parseCSV(await file.text());
    if(rows.length<2){msg('File CSV kosong.',1);return}
    const head=rows[0].map(h=>h.trim().toLowerCase());
    if(!head.includes('nama')){msg('Kolom "nama" tidak ditemukan. Gunakan file hasil Ekspor CSV sebagai template.',1);return}
    const nameMap={};Object.entries(CATS).forEach(([k,v])=>{nameMap[k.toLowerCase()]=k;nameMap[v.n.toLowerCase()]=k});
    const codeRe=new RegExp('^'+BU+'-([A-Z0-9]{2,4})-\\d{2}-\\d{4,}$');
    const work=items.slice(),fresh=[],newCats={},autoGen=new Set();let skip=0;
    for(const r of rows.slice(1)){
      const g=k=>{const i=head.indexOf(k.toLowerCase());return i<0?'':String(r[i]??'').trim().replace(/^'(?=[=+\-@])/,'')};
      const nama=g('nama');if(!nama){skip++;continue}
      const d=k=>isDate(g(k))?g(k):'';
      const tgl=d('tgl')||today();
      let kode=g('kode'),kat=null;
      const m=codeRe.exec(kode);
      if(m){ // klasifikasi dibaca dari kode, termasuk klasifikasi kustom yang belum ada di sini
        kat=m[1];
        if(!CATS[kat]&&!newCats[kat])newCats[kat]=g('kat')||kat;
      }else kat=nameMap[(g('kat')||g('klasifikasi')).toLowerCase()]||cat;
      if(kode&&work.some(i=>i.kode===kode)){skip++;continue}
      if(!kode){kode=genCode(kat,tgl,work);autoGen.add(kode)}
      const it={kode,kat,katNama:CATS[kat]?.n||newCats[kat]||kat,nama,merk:g('merk'),tipe:g('tipe'),sn:g('sn'),qty:Math.max(1,parseInt(g('qty'),10)||1),
        lokasi:g('lokasi'),kondisi:KONDISI.includes(g('kondisi'))?g('kondisi'):'Baik',pic:g('pic'),tgl,ket:g('ket'),
        kalLast:d('kalLast'),kalInt:parseInt(g('kalInt'),10)||'',kalNext:d('kalNext'),kalNo:g('kalNo'),dibuat:Date.now()};
      if(g('pinjamOleh'))it.pinjam={oleh:g('pinjamOleh'),proyek:g('pinjamProyek'),tgl:d('pinjamTgl')||today(),rencana:d('pinjamRencana'),cat:g('pinjamCat')};
      const rw=g('riwayat');
      if(rw){try{const a=JSON.parse(rw);if(Array.isArray(a))it.riwayat=a.slice(-50)}catch(e){}}
      work.push(it);fresh.push(it);
    }
    if(!fresh.length){msg('Tidak ada baris baru ('+skip+' dilewati: nama kosong / kode sudah ada).',1);return}
    const nc=Object.keys(newCats);
    if(!confirm('Impor '+fresh.length+' barang baru'+(skip?' ('+skip+' baris dilewati)':'')+(nc.length?'\nKlasifikasi baru: '+nc.map(k=>newCats[k]+' ('+k+')').join(', '):'')+'?'))return;
    nc.forEach(k=>{CATS[k]={n:newCats[k],custom:true}});
    if(nc.length){saveCustomCats();drawCats();drawFilter()}
    if(API){
      for(const k of nc)await api({action:'saveCat',kode:k,nama:newCats[k]});
      const rr=await api({action:'bulk',items:fresh.map(it=>autoGen.has(it.kode)?Object.assign({},it,{kode:''}):it)});
      await refresh();
      const sk=(rr.skipped||0)+skip;
      msg('Berhasil impor '+rr.added+' barang'+(sk?', '+sk+' dilewati':'')+'.');
      return;
    }
    items=work;persist();render();
    msg('Berhasil impor '+fresh.length+' barang'+(skip?', '+skip+' dilewati':'')+'.');
  }catch(err){msg('Gagal impor: '+(err&&err.message||'file tidak terbaca'),1)}
};

/* ================= init ================= */
async function init(){
  loadCustomCats();
  if(typeof qrcode==='undefined')msg('Library QR gagal dimuat (periksa koneksi internet). Label sementara hanya berisi teks.',1);
  drawFilter();drawCats();loadSize();label(null);render();
  if(API){
    col=true; // penanda mode database bersama
    $('stat').dataset.lock='1';$('stat').textContent='memuat dari Google Sheets…';
    try{await refresh()}
    catch(e){$('stat').textContent='gagal memuat: '+(e&&e.message||'periksa URL/token di config.js')}
    loaded=true;openFromHash();
    setInterval(()=>{if(!document.hidden)refresh().catch(()=>{})},30000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh().catch(()=>{})});
  }else{
    try{items=JSON.parse(localStorage.getItem(LS)||'[]')}catch(e){items=[]}
    render();drawCats();
    loaded=true;openFromHash();
  }
  syncQrOpt();
}
init();
