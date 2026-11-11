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
const P3K_KAT='P3K'; // kode klasifikasi P3K (klasifikasi apa pun yang namanya memuat "P3K" juga dikenali)
const isP3K=k=>k===P3K_KAT||/p3k/i.test(CATS[k]?.n||'');
const tools=()=>items.filter(i=>!isP3K(i.kat)); // barang biasa; kotak P3K punya kartu sendiri
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
  $('fkat').innerHTML='<option value="">Semua klasifikasi</option>'+Object.entries(CATS).filter(([k])=>!isP3K(k)).map(([k,c])=>`<option value="${k}">${esc(c.n)}</option>`).join('');
  $('fkat').value=CATS[v]?v:'';
}
function drawCats(){
  $('cats').innerHTML=Object.entries(CATS).map(([k,v])=>`<button type="button" class="cat ${k===cat?'on':''}" data-k="${k}"${editing?' disabled':''}><b>${esc(v.n)}</b></button>`).join('')
    +`<button type="button" class="cat add" data-add="1"${editing?' disabled':''}><b>+</b><small>Tambah klasifikasi</small></button>`;
  $('cats').querySelectorAll('.cat').forEach(b=>b.onclick=()=>{
    if(b.dataset.add){toggleAdd(true);return}
    cat=b.dataset.k;drawCats();showNext();
  });
  const c=CATS[cat];
  $('catDel').hidden=!(c&&c.custom&&!editing&&!items.some(i=>i.kat===cat));
  applyMode();
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
const LOGO='icons/eei-logo.png',LOGO_W='icons/eei-logo-white.png';
// tunggu gambar (logo) selesai dimuat sebelum dialog cetak dibuka, agar tidak tercetak kosong
function doPrint(){
  const imgs=[...document.querySelectorAll('#printArea img')];
  Promise.all(imgs.map(i=>i.decode?i.decode().catch(()=>{}):Promise.resolve())).then(()=>window.print());
}
function lblTone(it){return isP3K(it.kat)?'p3k':it.kondisi==='Rusak'?'rusak':it.kondisi==='Perlu kalibrasi'?'kal':it.kondisi==='Perlu perbaikan'?'perb':''}
const TONE_TXT={rusak:'RUSAK',kal:'KALIBRASI',perb:'PERBAIKAN'};
function labelHTML(it){
  const tn=lblTone(it);
  const head=tn==='p3k'
    ?`<div class="h"><span class="hl"><img class="lg" src="${LOGO_W}" alt=""><span>KOTAK P3K</span></span><svg class="pk" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/></svg></div>`
    :`<div class="h"><span class="hl"><img class="lg" src="${tn?LOGO_W:LOGO}" alt=""><span>ASSET TAG${tn?' · '+TONE_TXT[tn]:''}</span></span><span>${esc(catName(it.kat))}</span></div>`;
  const mk=esc([it.merk,it.tipe].filter(Boolean).join(' / ')),sn=it.sn?' · S/N '+esc(it.sn):'';
  if(tn==='p3k'){ // label khusus kotak P3K: QR membuka halaman pencatatan pemakaian isi
    if(useQR())return head+`<div class="q"><div class="qr"></div><div class="qd"><div class="c">${esc(it.kode)}</div><b>${esc(it.nama)}</b><span>Lokasi: ${esc(it.lokasi||'-')}</span><span>Scan: catat pemakaian isi</span><span>Reg: ${esc(it.tgl||'')}</span></div></div>`;
    return head+`<div class="c">${esc(it.kode)}</div>\n  <div class="d"><b>${esc(it.nama)}</b><br>Lokasi: ${esc(it.lokasi||'-')}<br>Scan QR untuk catat pemakaian</div>`;
  }
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
  if(!it){L.className='lbl';L.innerHTML='<div class="empty" style="margin:auto;color:#666">Label muncul setelah barang disimpan</div>';return}
  L.className='lbl'+(lblTone(it)?' t-'+lblTone(it):'');
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
    const d=document.createElement('div');d.className='lbl'+(lblTone(it)?' t-'+lblTone(it):'');d.innerHTML=labelHTML(it);sheet.appendChild(d);drawCode(d,it);count++;
  }});
  doPrint();
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
    if(it.isi)it.isi=it.isi.map(x=>x.id?x:Object.assign({id:uid()},x));
    const k=items.findIndex(x=>x.kode===it.kode);if(k>=0)items[k]=it;else items.push(it);persist();
  }
  lastItem=saved;
  render();
  return saved;
}

/* ================= tabel ================= */
function alerts(){
  const c={lewat:0,segera:0,telat:0,pinjam:0};
  tools().forEach(i=>{const k=kalState(i).k;if(k==='lewat')c.lewat++;if(k==='segera')c.segera++;if(i.pinjam){c.pinjam++;if(pinjamLate(i))c.telat++}});
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
  const list=tools().filter(d[1]).sort((a,b)=>a.kode.localeCompare(b.kode));
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
  tools().forEach(i=>{if(c[i.kondisi]!==undefined)c[i.kondisi]++;if(i.pinjam)c.pinjam++});
  $('sBaik').textContent=c.Baik;$('sKal').textContent=c['Perlu kalibrasi'];
  $('sPerb').textContent=c['Perlu perbaikan'];$('sRusak').textContent=c.Rusak;
  $('sPinjam').textContent=c.pinjam;$('sTsd').textContent=tools().length-c.pinjam;
  $('sumTot').textContent='Total '+tools().length+' barang';
}
const kondCls=k=>k==='Baik'?'ok':k==='Rusak'?'er':k==='Perlu kalibrasi'?'or':'wr';
const isMob=()=>window.matchMedia('(max-width:700px)').matches;
const PAGE=()=>isMob()?15:50;
let shownN=0,lastSig=null;const expanded=new Set();
function render(){
  syncCats();
  const q=$('cari').value.toLowerCase().trim(),f=$('fkat').value,st=$('fstat').value;
  const list=tools().filter(i=>(!f||i.kat===f)&&statusMatch(i,st)&&
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
      :'<span class="plain">Tersedia</span>';
    const hasHist=i.pinjam||(i.riwayat&&i.riwayat.length);
    const k=esc(i.kode);
    const kc=i.kondisi==='Rusak'?' k-rusak':i.kondisi==='Perlu kalibrasi'?' k-kal':i.kondisi==='Perlu perbaikan'?' k-perb':'';
    const kon=i.kondisi==='Baik'?'<span class="plain">Baik</span>':`<span class="bdg ${kondCls(i.kondisi)}">${esc(i.kondisi)}</span>`;
    const mt=esc([i.merk,i.tipe].filter(Boolean).join(' / '));
    const ib=(at,cls,tt,ic,tx)=>`<button class="btn ${cls} ib" ${at}="${k}" title="${tt}" aria-label="${tt}"><svg viewBox="0 0 24 24">${ic}</svg><span>${tx}</span></button>`;
    const IC={p:'<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/>',
      e:'<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
      b:'<path d="M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4"/>',
      k:'<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11"/>',
      r:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      f:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
      d:'<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'};
    return `<tr class="${lastItem&&lastItem.kode===i.kode?'sel':''}${expanded.has(i.kode)?' open':''}${kc}" data-row="${k}"><td><input type="checkbox" class="selr" data-k="${k}"${sel.has(i.kode)?' checked':''} aria-label="Pilih ${k}"></td><td class="code" data-label="Kode"><a href="#${k}" title="Lihat detail">${k}</a><small class="dsub">${esc(catName(i.kat))}</small></td><td class="mo" data-label="Klasifikasi">${esc(catName(i.kat))}</td><td data-label="Nama" class="nm">${esc(i.nama)}${mt?`<small class="dsub">${mt}</small>`:''}</td><td class="mo" data-label="Merk / Tipe">${mt}</td><td data-label="S/N" class="sn">${esc(i.sn)}</td><td data-label="Lokasi">${esc(i.lokasi)}</td><td data-label="Kondisi">${kon}</td><td data-label="Kalibrasi">${kal}</td><td data-label="Status">${pj}</td><td class="mo" data-label="Tgl">${esc(i.tgl)}</td>
    <td class="aksi">${ib('data-p','sec','Cetak label',IC.p,'Label')}${ib('data-e','sec','Edit',IC.e,'Edit')}${i.pinjam?ib('data-k','sec','Kembalikan',IC.k,'Kembalikan'):ib('data-b','sec','Pinjamkan',IC.b,'Pinjam')}${i.pinjam?ib('data-j','sec','Cetak form peminjaman',IC.f,'Form'):''}${hasHist?ib('data-r','sec','Riwayat',IC.r,'Riwayat'):''}${ib('data-d','dg','Hapus',IC.d,'Hapus')}</td></tr>`;
  }).join('');
  $('empty').hidden=list.length>0;
  $('moreWrap').hidden=rest<=0;
  $('more').textContent='Tampilkan lebih banyak ('+rest+' lagi)';
  $('empty').textContent=tools().length?'Tidak ada barang yang cocok dengan filter.':'Belum ada data.';
  if(!$('stat').dataset.lock)$('stat').textContent=tools().length+' barang tersimpan'+(col?'':' (lokal browser)');
  alerts();
  summary();
  updateBulk();
  renderP3k();
  showNext();
}
$('rows').onclick=async e=>{
  const b=e.target.closest('button');if(!b)return;
  const {p,e:ed,b:bw,k:kb,r,d,j}=b.dataset;
  if(j)printLoanForm(j);
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
  edP3k&&edP3k.clear();
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
  if(!nama){msg(isP3K(cat)?'Nama kotak P3K wajib diisi (kolom paling atas).':'Nama barang wajib diisi.',1);$('nama').focus();return}
  const p3k=isP3K(cat);
  let isi=null;
  if(p3k&&!editing){ // kotak baru: isi dibaca dari kotak teks (bisa banyak sekaligus)
    const r=parseIsi($('p3kText').value);
    if(r.errs.length){msg(r.errs[0]+(r.errs.length>1?' (+'+(r.errs.length-1)+' kesalahan lain)':''),1);$('p3kText').focus();return}
    isi=r.rows;
  }
  const kalLast=p3k?'':$('kalLast').value,kalNext=p3k?'':$('kalNext').value;
  if(kalLast&&kalNext&&kalNext<kalLast){msg('Jadwal kalibrasi berikutnya tidak boleh lebih awal dari kalibrasi terakhir.',1);$('kalBox').open=true;return}
  const sn=p3k?'':$('sn').value.trim();
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
  if(p3k){Object.assign(it,{merk:'',tipe:'',sn:'',qty:1,kondisi:'Baik',kalLast:'',kalInt:'',kalNext:'',kalNo:''});if(isi)it.isi=isi}
  if(editing)it.diubah=Date.now();
  $('simpan').disabled=true;
  try{
    const saved=await commit(it);
    const wasEdit=!!editing;
    lastItem=saved;
    if(wasEdit)endEdit(true);
    else{['nama','merk','tipe','sn','ket','kalLast','kalNext','kalNo'].forEach(k=>$(k).value='');$('qty').value=1;edP3k&&edP3k.clear()}
    label(saved);render();
    msg((wasEdit?'Diperbarui: ':'Tersimpan: ')+saved.kode+(p3k&&!wasEdit?' · '+(saved.isi||[]).length+' jenis isi':''));
  }catch(err){msg('Gagal menyimpan: '+(err&&err.message||'hak akses tidak cukup'),1)}
  finally{$('simpan').disabled=false}
};

/* ================= pinjam / kembali / riwayat ================= */
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());

const addDays=(d0,n)=>{const d=new Date(d0+'T00:00:00');d.setDate(d.getDate()+n);return fmt(d)};
const diffDays=(a,b)=>Math.round((new Date(b+'T00:00:00')-new Date(a+'T00:00:00'))/864e5);
const QUICK=[['Hari ini',0],['Besok',1],['3 hari',3],['1 minggu',7],['2 minggu',14],['1 bulan',30],['Tanpa batas',-1]];
function topCounts(fn){const m=new Map();items.forEach(i=>fn(i).forEach(v=>{v=String(v||'').trim();if(v)m.set(v,(m.get(v)||0)+1)}));return[...m.entries()].sort((a,b)=>b[1]-a[1]).map(e=>e[0])}
function pjDur(){
  const tgl=$('pjTgl').value||today(),ren=$('pjRen').value,el=$('pjDur');
  el.classList.remove('bad');
  document.querySelectorAll('#pjQuick .qc').forEach(b=>{const d=+b.dataset.d;b.classList.toggle('on',d<0?!ren:ren===addDays(tgl,d))});
  if(!ren){el.innerHTML='Tanpa batas waktu — tidak akan ditandai <b>telat</b>.';return}
  const n=diffDays(tgl,ren);
  if(n<0){el.classList.add('bad');el.textContent='Rencana kembali lebih awal dari tanggal pinjam.';return}
  el.innerHTML='Durasi pinjam: <b>'+(n===0?'hari ini juga':n+' hari')+'</b> · kembali '+esc(fmtID(ren));
}
$('pjQuick').onclick=e=>{const b=e.target.closest('.qc');if(!b)return;const d=+b.dataset.d;$('pjRen').value=d<0?'':addDays($('pjTgl').value||today(),d);pjDur()};
$('pjRecent').onclick=e=>{const b=e.target.closest('.qc');if(!b)return;$('pjOleh').value=b.dataset.n;$('pjProyek').focus()};
$('pjTgl').oninput=$('pjRen').oninput=pjDur;
/* ================= scan QR (kamera) ================= */
const SCAN_RE=/[A-Za-z0-9]{2,6}-[A-Za-z0-9]{2,4}-\d{2}-\d{3,}/;
let scanStream=null,scanTimer=0,scanBusy=false,scanDet=null,scanTrack=null,torchOn=false,scanBadAt=0,scanMode='detail',scanLastKode='',scanLastAt=0;
const scCv=document.createElement('canvas'),scCx=scCv.getContext('2d',{willReadFrequently:true});
function loadJsQR(){
  return window.jsQR?Promise.resolve():new Promise((ok,no)=>{
    const el=document.createElement('script');
    el.src='https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.min.js';
    el.onload=ok;el.onerror=()=>no(new Error('Pemindai gagal dimuat (periksa koneksi internet). Ketik kode manual di bawah.'));
    document.head.appendChild(el);
  });
}
function stopScan(){
  clearTimeout(scanTimer);scanBusy=false;torchOn=false;scanDet=null;scanTrack=null;
  if(scanStream){scanStream.getTracks().forEach(t=>t.stop());scanStream=null}
  $('scVideo').srcObject=null;
}
// kembalikan true bila kode ditemukan & detail dibuka
function handleScan(text){
  const m=SCAN_RE.exec(String(text||''));
  if(!m){
    if(Date.now()-scanBadAt>1500){scanBadAt=Date.now();$('scErr').textContent='QR ini bukan label barang.'}
    return false;
  }
  const kode=m[0].toUpperCase();
  if(scanMode==='opname'){ // mode stok opname: kamera tetap menyala, tiap barang dicatat
    const now=Date.now();
    if(kode===scanLastKode&&now-scanLastAt<2500)return false;
    scanLastKode=kode;scanLastAt=now;
    const r=opMark(kode);opFeedback(r);
    try{navigator.vibrate&&navigator.vibrate(r.s==='ok'?60:[40,60,40])}catch(e){}
    return false;
  }
  const it=items.find(i=>i.kode===kode);
  if(!it){
    if(Date.now()-scanBadAt>1500){scanBadAt=Date.now();$('scErr').textContent='Kode '+kode+' tidak terdaftar di database.'}
    return false;
  }
  try{navigator.vibrate&&navigator.vibrate(60)}catch(e){}
  stopScan();$('dlgScan').close();
  showDetail(kode);
  return true;
}
let scanN=0;
// jsQR: frame penuh (maks 960 px) dan potongan tengah (QR lebih besar) bergantian
function jsqrFrame(v){
  const vw=v.videoWidth,vh=v.videoHeight;
  let sx=0,sy=0,sw=vw,sh=vh,tw=Math.min(960,vw);
  if(++scanN%2===0){const q=Math.round(Math.min(vw,vh)*.7);sx=Math.round((vw-q)/2);sy=Math.round((vh-q)/2);sw=sh=q;tw=Math.min(720,q)}
  const th=Math.round(tw*sh/sw);
  scCv.width=tw;scCv.height=th;scCx.drawImage(v,sx,sy,sw,sh,0,0,tw,th);
  const r=jsQR(scCx.getImageData(0,0,tw,th).data,tw,th,{inversionAttempts:'dontInvert'});
  return r?r.data:'';
}
function prepScan(){
  scanDet=null;
  return (async()=>{
    if('BarcodeDetector' in window){
      try{const f=await BarcodeDetector.getSupportedFormats();if(f.includes('qr_code')){scanDet=new BarcodeDetector({formats:['qr_code']});return}}catch(e){}
    }
    await loadJsQR();
  })();
}
async function scanTick(){
  if(!scanStream)return;
  const v=$('scVideo');
  if(!v.paused&&v.readyState>=2&&v.videoWidth&&!scanBusy){
    scanBusy=true;
    try{
      let text='';
      if(scanDet){const r=await scanDet.detect(v);if(r.length)text=r[0].rawValue}
      else if(window.jsQR)text=jsqrFrame(v);
      if(text&&handleScan(text))return;
    }catch(e){}
    scanBusy=false;
  }
  scanTimer=setTimeout(scanTick,120);
}
async function openScan(mode){
  scanMode=mode==='opname'?'opname':'detail';scanLastKode='';
  $('scTitle').textContent=scanMode==='opname'?'Scan untuk opname':'Scan QR label';
  $('scSub').textContent=scanMode==='opname'?'Scan tiap barang satu per satu. Kamera tetap menyala.':'Arahkan kamera ke QR pada label barang';
  $('scInfo').hidden=true;$('scTap').hidden=true;
  $('scErr').textContent='';$('scManual').value='';$('scTorch').hidden=true;
  if(!$('dlgScan').open)$('dlgScan').showModal();
  const ready=prepScan();ready.catch(()=>{}); // muat pemindai sambil menunggu izin kamera
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
    $('scErr').textContent='Kamera tidak tersedia di browser ini. Jika dibuka lewat WhatsApp/Instagram, buka tautannya di Safari atau Chrome. Atau pakai tombol Foto QR / ketik kode manual.';return;
  }
  try{
    scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
  }catch(e){
    const n=e&&e.name;
    $('scErr').textContent=n==='NotAllowedError'||n==='SecurityError'
      ?'Izin kamera ditolak. Aktifkan izin kamera untuk situs ini di pengaturan browser (iPhone: Pengaturan > Safari > Kamera), atau pakai tombol Foto QR.'
      :n==='NotReadableError'?'Kamera sedang dipakai aplikasi lain. Tutup aplikasi itu lalu coba lagi, atau pakai tombol Foto QR.'
      :'Kamera tidak bisa dibuka'+(n?' ('+n+')':'')+'. Pakai tombol Foto QR atau ketik kode manual.';
    return;
  }
  if(!$('dlgScan').open){stopScan();return} // dialog ditutup saat menunggu izin
  const v=$('scVideo');
  v.muted=true;v.setAttribute('playsinline','');v.srcObject=scanStream;
  // iOS bisa menolak/menahan play() otomatis (mode hemat daya) -> jangan ditunggu, sediakan tombol ketuk
  try{const pr=v.play();if(pr&&pr.catch)pr.catch(()=>{$('scTap').hidden=false})}catch(e){$('scTap').hidden=false}
  setTimeout(()=>{if(scanStream&&(v.paused||v.readyState<2))$('scTap').hidden=false},1200);
  scanTrack=scanStream.getVideoTracks()[0];
  try{const caps=scanTrack.getCapabilities?scanTrack.getCapabilities():{};$('scTorch').hidden=!caps.torch}catch(e){}
  try{await ready}catch(e){$('scErr').textContent=e.message;return}
  if(!$('dlgScan').open||!scanStream)return;
  scanTick();
}
$('scVideo').addEventListener('playing',()=>{$('scTap').hidden=true});
$('scTap').onclick=()=>{const v=$('scVideo');v.muted=true;const pr=v.play();if(pr&&pr.catch)pr.catch(()=>{});$('scTap').hidden=true};
// kembali dari aplikasi lain / layar mati: kamera berhenti sendiri -> nyalakan lagi
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){if(scanStream&&$('dlgScan').open)stopScan();return}
  if($('dlgScan').open&&!scanStream)openScan(scanMode);
});
// cadangan: ambil foto QR dengan kamera bawaan, lalu dibaca
function readPhoto(file){
  return new Promise((ok,no)=>{
    const url=URL.createObjectURL(file),img=new Image();
    img.onload=()=>{URL.revokeObjectURL(url);ok(img)};
    img.onerror=()=>{URL.revokeObjectURL(url);no(new Error('Foto tidak bisa dibaca.'))};
    img.src=url;
  });
}
function decodeImage(img){
  const W=img.naturalWidth,H=img.naturalHeight,scale=Math.min(1,1600/Math.max(W,H));
  const tries=[[0,0,W,H],[.15,.15,.7,.7],[.25,.25,.5,.5]];
  for(const [fx,fy,fw,fh] of tries){
    const sx=Math.round(W*fx),sy=Math.round(H*fy),sw=Math.round(W*(fw)),sh=Math.round(H*(fh));
    const tw=Math.max(1,Math.round(sw*scale)),th=Math.max(1,Math.round(sh*scale));
    scCv.width=tw;scCv.height=th;scCx.drawImage(img,sx,sy,sw,sh,0,0,tw,th);
    const r=jsQR(scCx.getImageData(0,0,tw,th).data,tw,th,{inversionAttempts:'attemptBoth'});
    if(r&&r.data)return r.data;
  }
  return '';
}
$('scPhoto').onclick=()=>$('scFile').click();
$('scFile').onchange=async e=>{
  const f=e.target.files&&e.target.files[0];e.target.value='';
  if(!f)return;
  $('scErr').textContent='Membaca foto…';
  try{
    await loadJsQR();
    const text=decodeImage(await readPhoto(f));
    if(!text){$('scErr').textContent='QR tidak terbaca di foto. Dekatkan kamera, pastikan QR terang dan tidak buram, lalu coba lagi.';return}
    $('scErr').textContent='';
    handleScan(text);
  }catch(err){$('scErr').textContent=err&&err.message||'Foto gagal dibaca.'}
};
// siapkan pemindai cadangan di latar belakang (browser tanpa BarcodeDetector, mis. Safari iPhone)
if(!('BarcodeDetector' in window))window.addEventListener('load',()=>setTimeout(()=>loadJsQR().catch(()=>{}),2500));
$('scanBtn').onclick=$('scanFab').onclick=openScan;
$('dlgScan').addEventListener('close',()=>{stopScan();scanMode='detail';scanLastKode='';if(op&&$('dlgOpname').open)opRender()});
$('scForm').onsubmit=e=>{
  e.preventDefault();
  const val=$('scManual').value.trim();
  if(!val){$('scErr').textContent='Ketik kode barang dulu.';return}
  const ok=handleScan(val);
  if(scanMode==='opname'){$('scManual').value='';return}
  if(!ok&&!$('scErr').textContent)$('scErr').textContent='Kode tidak dikenali.';
};
$('scTorch').onclick=async()=>{
  if(!scanTrack)return;
  try{torchOn=!torchOn;await scanTrack.applyConstraints({advanced:[{torch:torchOn}]});$('scTorch').textContent=torchOn?'Matikan senter':'Senter'}
  catch(e){torchOn=false}
};

/* ================= stok opname ================= */
const OPK='kode-barang-opname-v1';
let op=null;
const nz=s=>String(s||'').trim().toLowerCase();
const opSave=()=>{try{localStorage.setItem(OPK,JSON.stringify(op))}catch(e){}};
const opLoad=()=>{try{return JSON.parse(localStorage.getItem(OPK)||'null')}catch(e){return null}};
const fmtDT=ms=>new Date(ms).toLocaleString('id-ID',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
const fmtHM=ms=>new Date(ms).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
function opInScope(it){const s=op.scope;return s.type==='lokasi'?nz(it.lokasi)===s.value:s.type==='kat'?it.kat===s.value:true}
function opLists(){
  const exp=items.filter(opInScope);
  return{exp,
    found:exp.filter(i=>op.found[i.kode]),
    borrowed:exp.filter(i=>!op.found[i.kode]&&i.pinjam),
    missing:exp.filter(i=>!op.found[i.kode]&&!i.pinjam),
    extra:Object.keys(op.extra).map(k=>items.find(i=>i.kode===k)).filter(Boolean)};
}
const opView=v=>['opSetup','opRun','opReport'].forEach(id=>$(id).hidden=id!==v);
function opMark(kode){
  const it=items.find(i=>i.kode===kode);
  if(!it)return{s:'unknown',kode};
  if(op.found[kode]||op.extra[kode])return{s:'dup',it};
  if(opInScope(it)){op.found[kode]=Date.now();opSave();return{s:'ok',it}}
  op.extra[kode]=Date.now();opSave();return{s:'extra',it};
}
function opFeedback(r){
  const L=opLists(),done=L.found.length+L.borrowed.length;
  const nm=r.it?r.it.kode+' · '+r.it.nama:r.kode;
  let t,c='ok';
  if(r.s==='ok')t='✓ '+nm;
  else if(r.s==='dup'){t='Sudah dicatat: '+nm;c='mu'}
  else if(r.s==='extra'){t='⚠ '+nm+' — di luar lingkup opname (tercatat di: '+(r.it.lokasi||'tanpa lokasi')+')';c='warn'}
  else{t='Kode '+r.kode+' tidak terdaftar.';c='warn'}
  const txt=t+'  ·  '+done+' / '+L.exp.length;
  const a=$('scInfo');a.className='scinfo '+c;a.textContent=txt;a.hidden=false;
  const b=$('opInfo');b.className='opinfo '+c;b.textContent=txt;b.hidden=false;
  $('scErr').textContent='';
  if($('dlgOpname').open)opRender();
}
function opFillVal(){
  const t=$('opType').value;
  $('opValWrap').hidden=t==='all';
  if(t==='lokasi'){
    const m=new Map();
    items.forEach(i=>{const k=nz(i.lokasi),e=m.get(k)||{n:(i.lokasi||'').trim()||'(tanpa lokasi)',c:0};e.c++;m.set(k,e)});
    $('opValLbl').textContent='Lokasi simpan';
    $('opVal').innerHTML=[...m.entries()].sort((a,b)=>a[1].n.localeCompare(b[1].n)).map(([k,e])=>`<option value="${esc(k)}">${esc(e.n)} (${e.c})</option>`).join('');
  }else if(t==='kat'){
    $('opValLbl').textContent='Klasifikasi';
    $('opVal').innerHTML=Object.entries(CATS).map(([k,v])=>`<option value="${esc(k)}">${esc(v.n)} (${items.filter(i=>i.kat===k).length})</option>`).join('');
  }
  opCountHint();
}
function opCountHint(){
  const t=$('opType').value,v=$('opVal').value;
  const n=t==='all'?items.length:items.filter(i=>t==='lokasi'?nz(i.lokasi)===v:i.kat===v).length;
  $('opCount').textContent=n+' barang akan diperiksa.';
  $('opStart').disabled=!n;
}
function openOpname(){
  const saved=opLoad();
  $('opResume').hidden=!saved;
  if(saved){
    $('opResInfo').textContent=saved.scope.label+' · mulai '+fmtDT(saved.startedAt)+' · '+Object.keys(saved.found).length+' sudah ditandai'+(saved.finishedAt?' · laporan sudah dibuat':'');
  }
  opView('opSetup');$('opSub').textContent='Cek fisik barang dengan scan QR';
  $('opInfo').hidden=true;
  opFillVal();
  if(!$('dlgOpname').open)$('dlgOpname').showModal();
}
const OPI={
  mark:'<path d="m8.5 12.5 2.5 2.5 4.5-5"/><circle cx="12" cy="12" r="9"/>',
  unmark:'<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11"/>',
  rm:'<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'
};
function opRender(){
  if(!op)return;
  const L=opLists(),done=L.found.length+L.borrowed.length,tot=L.exp.length,pct=tot?Math.round(done/tot*100):100;
  $('opSub').textContent=op.scope.label;
  $('opPct').textContent=pct+'%';
  $('opTxt').textContent=L.found.length+' ditemukan · '+L.borrowed.length+' dipinjam · '+L.missing.length+' belum';
  $('opBar').style.width=pct+'%';
  const tabs=[['belum','Belum',L.missing.length,'er'],['ada','Ditemukan',L.found.length,'ok'],['pinjam','Dipinjam',L.borrowed.length,''],['luar','Di luar daftar',L.extra.length,'wr']];
  $('opTabs').innerHTML=tabs.map(([k,t,n,c])=>`<button type="button" class="chip ${c}${op.tab===k?' on':''}" data-t="${k}">${t} (${n})</button>`).join('');
  const list={belum:L.missing,ada:L.found,pinjam:L.borrowed,luar:L.extra}[op.tab]||[];
  const act={belum:['mark','Tandai ada'],ada:['unmark','Batalkan'],pinjam:['mark','Tandai ada'],luar:['rm','Hapus']}[op.tab];
  const meta=i=>op.tab==='ada'?'Ditandai '+fmtHM(op.found[i.kode])+(i.lokasi?' · '+i.lokasi:'')
    :op.tab==='pinjam'?'Dipinjam: '+i.pinjam.oleh+(i.pinjam.proyek?' · '+i.pinjam.proyek:'')
    :[i.lokasi&&'Lokasi: '+i.lokasi,[i.merk,i.tipe].filter(Boolean).join(' / ')].filter(Boolean).join(' · ');
  $('opList').innerHTML=list.length?list.slice(0,300).map(i=>`<div class="opit"><div class="opi"><code>${esc(i.kode)}</code><b>${esc(i.nama)}</b><small>${esc(meta(i))}</small></div><button type="button" class="btn sec ib" data-op="${act[0]}" data-k="${esc(i.kode)}" title="${act[1]}"><svg viewBox="0 0 24 24">${OPI[act[0]]}</svg><span>${act[1]}</span></button></div>`).join('')
    :'<div class="lsempty">'+(op.tab==='belum'?'Semua barang sudah terhitung.':'Tidak ada barang di daftar ini.')+'</div>';
}
function opReportView(){
  const L=opLists();
  opView('opReport');$('opSub').textContent='Laporan · '+op.scope.label;
  $('rpWhen').textContent='Mulai '+fmtDT(op.startedAt)+' · Selesai '+fmtDT(op.finishedAt||Date.now());
  $('rpTot').textContent=L.exp.length;$('rpFound').textContent=L.found.length;$('rpBorrow').textContent=L.borrowed.length;
  $('rpMiss').textContent=L.missing.length;$('rpExtra').textContent=L.extra.length;
  const row=i=>`<div class="lsitem"><code>${esc(i.kode)}</code><b>${esc(i.nama)}</b><small>${esc([i.lokasi&&'Lokasi: '+i.lokasi,[i.merk,i.tipe].filter(Boolean).join(' / ')].filter(Boolean).join(' · '))}</small></div>`;
  $('rpMissT').textContent='Belum ditemukan ('+L.missing.length+')';
  $('rpMissL').innerHTML=L.missing.length?L.missing.slice(0,300).map(row).join(''):'<div class="lsempty">Tidak ada. Semua barang terhitung.</div>';
  $('rpExtraBox').hidden=!L.extra.length;
  $('rpExtraL').innerHTML=L.extra.map(row).join('');
}
function opRows(){
  const L=opLists(),rows=[['Status','Kode','Nama barang','Klasifikasi','Merk / Tipe','S/N','Lokasi tercatat','Peminjam','Waktu scan']];
  const add=(st,i,ts)=>rows.push([st,i.kode,i.nama,catName(i.kat),[i.merk,i.tipe].filter(Boolean).join(' / '),i.sn||'',i.lokasi||'',i.pinjam?i.pinjam.oleh:'',ts?fmtDT(ts):'']);
  L.missing.forEach(i=>add('Belum ditemukan',i));
  L.found.forEach(i=>add('Ditemukan',i,op.found[i.kode]));
  L.borrowed.forEach(i=>add('Dipinjam',i));
  L.extra.forEach(i=>add('Di luar daftar',i,op.extra[i.kode]));
  return rows;
}
function dlCSV(name,rows){
  const q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob(['\ufeff'+rows.map(r=>r.map(q).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
  a.download=name;document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);
}
function opReportDoc(){
  const L=opLists(),org=(window.CONFIG&&CONFIG.ORG)||'';
  const kv=(k,v)=>`<div><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`;
  const tb=(cols,rows)=>rows.length?`<table><thead><tr><th>No</th>${cols.map(c=>`<th>${c[0]}</th>`).join('')}</tr></thead><tbody>${rows.map((i,n)=>`<tr><td>${n+1}</td>${cols.map(c=>`<td>${esc(c[1](i)||'-')}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<p class="none">Tidak ada.</p>';
  const base=[['Kode',i=>i.kode],['Nama barang',i=>i.nama],['Merk / Tipe',i=>[i.merk,i.tipe].filter(Boolean).join(' / ')],['S/N',i=>i.sn],['Lokasi',i=>i.lokasi]];
  const sg=r=>`<div class="sg"><div class="rl">${r}</div><div class="sp"></div><div class="nm">(................................)</div><small>Tanggal: ....................</small></div>`;
  return `<div class="doc multi">
  <div class="dh"><img class="dlogo" src="${LOGO}" alt=""><div class="dt">${org?`<div class="org">${esc(org)}</div>`:''}<h1>LAPORAN STOK OPNAME</h1><div class="no">${esc(op.scope.label)} · ${esc(fmtDT(op.finishedAt||Date.now()))}</div></div></div>
  <h2>Ringkasan</h2>
  <div class="kv">${kv('Barang diperiksa',L.exp.length)}${kv('Ditemukan',L.found.length)}${kv('Sedang dipinjam',L.borrowed.length)}${kv('Belum ditemukan',L.missing.length)}${kv('Di luar daftar',L.extra.length)}${kv('Mulai',fmtDT(op.startedAt))}</div>
  <h2>Belum ditemukan (${L.missing.length})</h2>${tb(base,L.missing)}
  ${L.extra.length?`<h2>Di luar daftar (${L.extra.length})</h2>${tb(base,L.extra)}`:''}
  ${L.borrowed.length?`<h2>Sedang dipinjam (${L.borrowed.length})</h2>${tb([['Kode',i=>i.kode],['Nama barang',i=>i.nama],['Peminjam',i=>i.pinjam.oleh],['Proyek',i=>i.pinjam.proyek]],L.borrowed)}`:''}
  <h2>Ditemukan (${L.found.length})</h2>${tb(base,L.found)}
  <div class="sig">${sg('Pelaksana opname')}${sg('Mengetahui')}</div>
  <div class="dfoot">Dokumen ini dibuat dari aplikasi Registrasi Kode Barang.</div>
 </div>`;
}
$('opBtn').onclick=openOpname;
$('opType').onchange=opFillVal;$('opVal').onchange=opCountHint;
$('opStart').onclick=()=>{
  const t=$('opType').value,v=t==='all'?'':$('opVal').value;
  const nm=t==='all'?'':$('opVal').selectedOptions[0].textContent.replace(/ \(\d+\)$/,'');
  const old=opLoad();
  if(old&&Object.keys(old.found).length&&!confirm('Sesi opname sebelumnya akan diganti. Lanjutkan?'))return;
  op={scope:{type:t,value:v,label:t==='all'?'Semua barang':(t==='lokasi'?'Lokasi: ':'Klasifikasi: ')+nm},startedAt:Date.now(),found:{},extra:{},tab:'belum'};
  opSave();$('opInfo').hidden=true;opView('opRun');opRender();
};
$('opResBtn').onclick=()=>{
  const saved=opLoad();if(!saved)return;
  op=saved;$('opInfo').hidden=true;
  if(op.finishedAt){opReportView()}else{opView('opRun');opRender()}
};
$('opScan').onclick=()=>openScan('opname');
$('opForm').onsubmit=e=>{
  e.preventDefault();
  const v=$('opKode').value.trim();if(!v)return;
  const m=SCAN_RE.exec(v);
  if(!m){const b=$('opInfo');b.className='opinfo warn';b.textContent='Kode tidak valid.';b.hidden=false;return}
  opFeedback(opMark(m[0].toUpperCase()));$('opKode').value='';
};
$('opTabs').onclick=e=>{const b=e.target.closest('.chip');if(!b||!op)return;op.tab=b.dataset.t;opSave();opRender()};
$('opList').onclick=e=>{
  const b=e.target.closest('button[data-op]');if(!b||!op)return;
  const k=b.dataset.k,a=b.dataset.op;
  if(a==='mark')op.found[k]=Date.now();
  if(a==='unmark')delete op.found[k];
  if(a==='rm')delete op.extra[k];
  opSave();opRender();
};
$('opFinish').onclick=()=>{
  const L=opLists();
  if(L.missing.length&&!confirm('Masih ada '+L.missing.length+' barang yang belum ditemukan.\nLihat laporan sekarang? (sesi masih bisa dilanjutkan)'))return;
  op.finishedAt=Date.now();opSave();opReportView();
};
$('opPause').onclick=()=>{opSave();$('dlgOpname').close();msg('Sesi opname disimpan. Lanjutkan lewat tombol Stok opname.')};
$('opBack').onclick=()=>{op.finishedAt=null;opSave();opView('opRun');opRender()};
$('opCsv').onclick=()=>dlCSV('stok-opname-'+today()+'.csv',opRows());
$('opPrint').onclick=()=>{
  $('printArea').innerHTML=opReportDoc();
  document.title='Laporan-Stok-Opname-'+today();
  doPrint();
};
$('opDone').onclick=()=>{
  if(!confirm('Hapus sesi opname ini dari perangkat?\nPastikan laporan sudah diekspor atau dicetak.'))return;
  try{localStorage.removeItem(OPK)}catch(e){}
  op=null;$('dlgOpname').close();msg('Sesi opname dihapus.');
};

/* ================= cetak daftar barang (PDF) ================= */
function listFilterText(){
  const p=[],q=$('cari').value.trim();
  if($('fkat').value)p.push('Klasifikasi: '+$('fkat').selectedOptions[0].textContent);
  if($('fstat').value)p.push('Status: '+$('fstat').selectedOptions[0].textContent);
  if(q)p.push('Pencarian: "'+q+'"');
  return p.length?p.join(' · '):'';
}
function openCetakList(){
  const ft=listFilterText();
  $('clScope').innerHTML=`<option value="filter">Sesuai tampilan saat ini (${visible.length} barang)</option><option value="all">Semua barang (${tools().length})</option>`;
  $('clHint').textContent=ft?'Filter aktif — '+ft:'Tidak ada filter aktif.';
  $('dlgCetakList').showModal();
}
function listDocHTML(o){
  const org=(window.CONFIG&&CONFIG.ORG)||'';
  const list=(o.scope==='all'?tools():visible.map(k=>items.find(i=>i.kode===k)).filter(Boolean)).sort((a,b)=>a.kode.localeCompare(b.kode));
  const c={baik:0,kal:0,perb:0,rusak:0,pinjam:0};
  list.forEach(i=>{
    if(i.kondisi==='Perlu kalibrasi')c.kal++;else if(i.kondisi==='Perlu perbaikan')c.perb++;else if(i.kondisi==='Rusak')c.rusak++;else c.baik++;
    if(i.pinjam)c.pinjam++;
  });
  const kon=i=>{const k=i.kondisi==='Rusak'?'kr':i.kondisi==='Perlu kalibrasi'?'kk':i.kondisi==='Perlu perbaikan'?'kp':'';return `<span class="${k}">${esc(i.kondisi||'Baik')}</span>`};
  const cols=[
    ['Kode',i=>esc(i.kode),'mono'],
    ['Nama barang',i=>`<b>${esc(i.nama)}</b>`],
    ['Merk / Tipe',i=>esc([i.merk,i.tipe].filter(Boolean).join(' / ')||'-')],
    ['S/N',i=>esc(i.sn||'-')],
    ['Jml',i=>esc(i.qty||1)],
    ['Lokasi',i=>esc(i.lokasi||'-')],
    ['Kondisi',kon]];
  if(o.kal){
    cols.push(['Kalibrasi berikutnya',i=>{const ks=kalState(i);return i.kalNext?esc(fmtID(i.kalNext))+(ks.k&&ks.k!=='ok'?`<br><small class="${ks.k==='lewat'?'kr':'kk'}">${esc(ks.t)}</small>`:''):'-'}]);
    cols.push(['Status',i=>i.pinjam?`${pinjamLate(i)?'<span class="kr">Telat kembali</span>':'Dipinjam'}<br><small>${esc(i.pinjam.oleh)}${i.pinjam.proyek?' · '+esc(i.pinjam.proyek):''}</small>`:'Tersedia']);
  }
  let n=0;
  const row=i=>`<tr><td>${++n}</td>${cols.map(k=>`<td${k[2]?` class="${k[2]}"`:''}>${k[1](i)}</td>`).join('')}</tr>`;
  let body='';
  if(o.group){
    const g=new Map();
    list.forEach(i=>{
      const key=o.group==='kat'?catName(i.kat):((i.lokasi||'').trim()||'(tanpa lokasi)'),id=key.toLowerCase();
      const e=g.get(id)||{n:key,a:[]};e.a.push(i);g.set(id,e);
    });
    [...g.values()].sort((a,b)=>a.n.localeCompare(b.n)).forEach(e=>{
      body+=`<tr class="grp"><td colspan="${cols.length+1}">${esc(e.n)} (${e.a.length})</td></tr>`+e.a.map(row).join('');
    });
  }else body=list.map(row).join('');
  const ft=o.scope==='all'?'Semua barang':(listFilterText()||'Semua barang');
  return `<div class="doc land multi">
  <div class="dh"><img class="dlogo" src="${LOGO}" alt=""><div class="dt">${org?`<div class="org">${esc(org)}</div>`:''}<h1>DAFTAR INVENTARIS BARANG</h1><div class="no">${esc(ft)} · Dicetak ${esc(fmtID(today()))}</div></div></div>
  <div class="sumline">Total <b>${list.length}</b> barang · Baik <b>${c.baik}</b> · Perlu kalibrasi <b>${c.kal}</b> · Perlu perbaikan <b>${c.perb}</b> · Rusak <b>${c.rusak}</b> · Sedang dipinjam <b>${c.pinjam}</b></div>
  <table class="lt"><thead><tr><th>No</th>${cols.map(k=>`<th>${k[0]}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
  <div class="dfoot">Dokumen ini dibuat dari aplikasi Registrasi Kode Barang.</div>
 </div>`;
}
$('pdfList').onclick=openCetakList;
$('fCetakList').onsubmit=e=>{
  e.preventDefault();
  const o={scope:$('clScope').value,group:$('clGroup').value,kal:$('clKal').checked};
  const total=o.scope==='all'?tools().length:visible.length;
  if(!total){msg('Tidak ada barang untuk dicetak.',1);return}
  $('dlgCetakList').close();
  setTimeout(()=>{
    $('printArea').innerHTML=listDocHTML(o);
    document.title='Daftar-Barang-'+today();
    doPrint();
  },150);
};

/* ================= form peminjaman (cetak / simpan PDF) ================= */
const LOAN_TERMS=[
  'Peminjam bertanggung jawab atas keamanan dan kondisi barang selama masa peminjaman.',
  'Barang digunakan sesuai peruntukan dan tidak dipindahtangankan tanpa sepengetahuan yang menyerahkan.',
  'Barang dikembalikan paling lambat pada tanggal rencana kembali; perpanjangan dikonfirmasi terlebih dahulu.',
  'Kerusakan atau kehilangan wajib dilaporkan segera dan menjadi tanggung jawab peminjam sesuai ketentuan perusahaan.'
];
const BASE_TITLE=document.title;
window.addEventListener('afterprint',()=>{document.title=BASE_TITLE});
function loanFormHTML(it){
  const p=it.pinjam,v=x=>esc(x||'-');
  const org=(window.CONFIG&&CONFIG.ORG)||'';
  const noDok='PJM/'+it.kode+'/'+String(p.tgl||today()).replace(/-/g,'');
  const kv=(k,val,w)=>`<div${w?' class="w"':''}><span class="k">${k}</span><span class="v">${val}</span></div>`;
  const mt=[it.merk,it.tipe].filter(Boolean).join(' / ');
  const kn=it.kalNext?fmtID(it.kalNext):'';
  const sig=(a,b)=>`<div class="sig">${[a,b].map(x=>`<div class="sg"><div class="rl">${esc(x.role)}</div><div class="sp"></div><div class="nm">${x.name?esc(x.name):'(................................)'}</div><small>${esc(x.note||'Tanggal: ....................')}</small></div>`).join('')}</div>`;
  return `<div class="doc">
  <div class="dh"><img class="dlogo" src="${LOGO}" alt=""><div class="dt">${org?`<div class="org">${esc(org)}</div>`:''}<h1>FORMULIR PEMINJAMAN BARANG</h1><div class="no">No. ${esc(noDok)} · Dicetak ${esc(fmtID(today()))}</div></div><div class="qr dqr"></div></div>
  <h2>A. Data barang</h2>
  <div class="kv">${kv('Kode barang',esc(it.kode))}${kv('Klasifikasi',v(catName(it.kat)))}${kv('Nama barang',v(it.nama),1)}${kv('Merk / Tipe',v(mt))}${kv('Serial number',v(it.sn))}${kv('Jumlah',esc(it.qty||1))}${kv('Lokasi simpan',v(it.lokasi))}${kv('Kondisi saat dipinjam',v(it.kondisi))}${kv('Kalibrasi berikutnya',v(kn))}</div>
  <h2>B. Data peminjaman</h2>
  <div class="kv">${kv('Peminjam',v(p.oleh))}${kv('Proyek / tujuan',v(p.proyek))}${kv('Tanggal pinjam',v(fmtID(p.tgl)))}${kv('Rencana kembali',p.rencana?esc(fmtID(p.rencana)):'Tanpa batas waktu')}${kv('Catatan',v(p.cat),1)}</div>
  <h2>C. Ketentuan</h2>
  <ol>${LOAN_TERMS.map(t=>`<li>${esc(t)}</li>`).join('')}</ol>
  ${sig({role:'Peminjam',name:p.oleh,note:'Tanggal: '+(fmtID(p.tgl)||'....................')},{role:'Yang menyerahkan',name:it.pic,note:'Tanggal: '+(fmtID(p.tgl)||'....................')})}
  <h2>D. Pengembalian <span class="sm">(diisi saat barang dikembalikan)</span></h2>
  <div class="kv"><div class="w"><span class="k">Tanggal kembali</span><span class="ln"></span></div>
   <div class="w"><span class="k">Kondisi saat kembali</span><span class="v"><i class="cb"></i>Baik <i class="cb"></i>Perlu kalibrasi <i class="cb"></i>Perlu perbaikan <i class="cb"></i>Rusak</span></div>
   <div class="w"><span class="k">Catatan</span><span class="ln wide"></span></div>
   <div class="w"><span class="k"></span><span class="ln wide"></span></div></div>
  ${sig({role:'Peminjam',name:'',note:'Tanggal: ....................'},{role:'Penerima',name:'',note:'Tanggal: ....................'})}
  <div class="dfoot">Dokumen ini dibuat dari aplikasi Registrasi Kode Barang. Simpan bersama arsip peminjaman.</div>
 </div>`;
}
function printLoanForm(kode){
  const it=items.find(i=>i.kode===kode);
  if(!it||!it.pinjam){msg('Barang ini tidak sedang dipinjam.',1);return}
  const pa=$('printArea');pa.innerHTML=loanFormHTML(it);
  drawCode(pa,it);
  document.title='Form-Peminjaman-'+it.kode;
  doPrint();
}

function openPinjam(kode){
  const it=items.find(i=>i.kode===kode);if(!it)return;
  dlgKode=kode;
  $('pjKode').textContent=kode;$('pjNama').textContent=it.nama;
  $('pjMeta').innerHTML=(it.lokasi?'<span>'+esc(it.lokasi)+'</span>':'')+(it.merk||it.tipe?'<span>'+esc([it.merk,it.tipe].filter(Boolean).join(' / '))+'</span>':'')+'<span class="bdg '+kondCls(it.kondisi||'Baik')+'">'+esc(it.kondisi||'Baik')+'</span>';
  const orang=topCounts(i=>[i.pinjam&&i.pinjam.oleh,...(i.riwayat||[]).map(r=>r.oleh)]);
  $('pjOlehList').innerHTML=orang.slice(0,40).map(n=>`<option value="${esc(n)}">`).join('');
  $('pjRecent').innerHTML=orang.length?'<span class="qcl">Sering meminjam:</span>'+orang.slice(0,5).map(n=>`<button type="button" class="qc" data-n="${esc(n)}">${esc(n)}</button>`).join(''):'';
  $('pjProyekList').innerHTML=topCounts(i=>[i.pinjam&&i.pinjam.proyek,...(i.riwayat||[]).map(r=>r.proyek)]).slice(0,40).map(n=>`<option value="${esc(n)}">`).join('');
  $('pjQuick').innerHTML=QUICK.map(([t,d])=>`<button type="button" class="qc" data-d="${d}">${t}</button>`).join('');
  ['pjOleh','pjProyek','pjRen','pjCat'].forEach(k=>$(k).value='');$('pjTgl').value=today();$('pjErr').textContent='';pjDur();
  try{$('pjPrint').checked=localStorage.getItem('kode-barang-pjprint')==='1'}catch(e){}
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
  const ok=$('pjOk');ok.disabled=true;ok.textContent='Menyimpan…';
  const wantPrint=$('pjPrint').checked;try{localStorage.setItem('kode-barang-pjprint',wantPrint?'1':'0')}catch(e){}
  try{await commit(upd);$('dlgPinjam').close();msg('Dipinjamkan: '+it.kode+' → '+oleh);if(wantPrint)setTimeout(()=>printLoanForm(it.kode),200)}
  catch(err){$('pjErr').textContent='Gagal menyimpan: '+(err&&err.message||'hak akses tidak cukup')}
  finally{ok.disabled=false;ok.textContent='Pinjamkan'}
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
  }else if(isP3K(it.kat)){
    const row=(a,b)=>b?`<dt>${a}</dt><dd>${b}</dd>`:'';
    $('dtBody').innerHTML=`<div class="dtname">${esc(it.nama)}</div><dl class="dl">`
      +row('Klasifikasi',esc(catName(it.kat)))+row('Lokasi simpan',esc(it.lokasi))+row('PIC',esc(it.pic))
      +row('Tgl registrasi',esc(fmtID(it.tgl)))+row('Keterangan',esc(it.ket))+'</dl>'+p3kUseHTML(it);
    $('dtActs').innerHTML='<button class="btn sec" type="button" data-act="p3kadd">Tambah isi</button> <button class="btn sec" type="button" data-act="p3klog">Riwayat pemakaian</button> <button class="btn sec" type="button" data-act="edit">Edit kotak</button> <button class="btn sec" type="button" data-close="1">Tutup</button>';
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
      +(p?' <button class="btn sec" type="button" data-act="form">Cetak form</button>':'')
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
  if(a==='form')setTimeout(()=>printLoanForm(k),120);
  if(a==='edit')startEdit(k);
  if(a==='p3kadd')openP3kAdd(k);
  if(a==='p3klog')showP3kLog(k);
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

/* ================= P3K: kotak, isi & pemakaian ================= */
const uid=()=>Math.random().toString(36).slice(2,10);
const LSW='kode-barang-p3kwho';
const P3K_STD=`Kasa steril ; 10 ; bungkus ; 4
Perban gulung 5 cm ; 6 ; roll ; 2
Perban gulung 10 cm ; 4 ; roll ; 2
Plester gulung ; 4 ; roll ; 2
Plester luka kecil ; 20 ; pcs ; 10
Kapas ; 1 ; bungkus ; 1
Mitella (kain segitiga) ; 2 ; pcs ; 1
Gunting ; 1 ; pcs ; 1
Peniti ; 6 ; pcs ; 3
Pinset ; 1 ; pcs ; 1
Sarung tangan sekali pakai ; 10 ; pasang ; 4
Masker ; 10 ; pcs ; 4
Alkohol 70% ; 1 ; botol ; 1
Povidone iodine ; 1 ; botol ; 1
Larutan NaCl 0,9% ; 2 ; botol ; 1
Gelas cuci mata ; 1 ; pcs ; 1
Kantong plastik bersih ; 2 ; pcs ; 1
Senter kecil ; 1 ; pcs ; 1
Buku catatan & pensil ; 1 ; set ; 1`;

// formulir: tampilan berbeda saat klasifikasi P3K dipilih
function applyMode(){
  const p=isP3K(cat);
  document.querySelectorAll('[data-np]').forEach(el=>el.hidden=p);
  $('p3kBox').hidden=!p||!!editing;
  $('namaLbl').textContent=p?'Nama kotak P3K *':'Nama barang *';
  $('nama').placeholder=p?'mis. Kotak P3K Gudang A / Kotak P3K Mobil Proyek':'mis. Insulation Tester / Torque Wrench / Kabel NYY';
  $('simpan').textContent=editing?'Simpan perubahan':(p?'Simpan kotak & buat label P3K':'Simpan & buat label');
  $('p3kCard').hidden=!(p||items.some(i=>isP3K(i.kat))||Object.keys(CATS).some(isP3K));
}

/* ---- baca daftar isi dari teks (satu baris = satu barang) ---- */
function normDate(v){
  v=String(v||'').trim();if(!v)return '';
  if(isDate(v))return v;
  const m=/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(v);
  if(m){const d=+m[1],mo=+m[2];if(mo>=1&&mo<=12&&d>=1&&d<=31)return m[3]+'-'+pad(mo)+'-'+pad(d)}
  return null;
}
function parseIsi(text){
  const rows=[],errs=[];
  String(text||'').split(/\r?\n/).forEach((ln,n)=>{
    ln=ln.trim();if(!ln)return;
    const parts=ln.split(/\t|;|\|/).map(x=>x.trim()),nama=parts[0];
    if(!nama){errs.push('Baris '+(n+1)+': nama kosong');return}
    if(rows.length===0&&!errs.length&&/^nama/i.test(nama)&&parts[1]&&isNaN(parseInt(parts[1],10)))return; // baris judul kolom dari Excel
    const num=(v,d)=>{if(v===undefined||v==='')return d;if(!/^\d+$/.test(v))return NaN;return Math.min(99999,parseInt(v,10))};
    const stok=num(parts[1],1),min=num(parts[3],0),exp=normDate(parts[4]);
    if(isNaN(stok)||isNaN(min)){errs.push('Baris '+(n+1)+' ("'+nama.slice(0,24)+'"): jumlah / stok minimum harus angka');return}
    if(exp===null){errs.push('Baris '+(n+1)+' ("'+nama.slice(0,24)+'"): kadaluarsa pakai format YYYY-MM-DD');return}
    rows.push({nama:nama.slice(0,120),stok,satuan:(parts[2]||'pcs').slice(0,20),min,exp});
  });
  return{rows,errs};
}
function countMsg(text,el){
  if(!String(text).trim()){el.textContent='';el.className='hint';return}
  const r=parseIsi(text);
  el.className='hint'+(r.errs.length?' er':'');
  el.textContent=r.rows.length+' barang terbaca'+(r.errs.length?' · '+r.errs[0]+(r.errs.length>1?' (+'+(r.errs.length-1)+' lainnya)':''):'');
}
function updateP3kCount(){}
/* ---- editor isi kotak: kartu per barang (tanpa mengetik format) ---- */
var edP3k,edPa;
const SATUAN=['pcs','bungkus','roll','botol','pasang','set','box','lembar','tube','strip'];
function makeIsiEditor(host,ta,countEl){
  let rows=[];
  const blank=()=>({nama:'',stok:1,satuan:'pcs',min:0,exp:''});
  const std=()=>parseIsi(P3K_STD).rows.map(r=>({nama:r.nama,stok:r.stok,satuan:r.satuan,min:r.min,exp:r.exp||''}));
  const clean=v=>String(v).replace(/[;|\t\r\n]+/g,' ').trim();
  const num=(v,d)=>{const n=parseInt(v,10);return isNaN(n)?d:Math.max(0,Math.min(99999,n))};
  function sync(){
    const ok=rows.filter(r=>clean(r.nama));
    ta.value=ok.map(r=>[clean(r.nama),num(r.stok,1),r.satuan||'pcs',num(r.min,0)].concat(r.exp?[r.exp]:[]).join(' ; ')).join('\n');
    const kosong=rows.length-ok.length;
    countEl.className='hint'+(kosong?' er':'');
    countEl.textContent=rows.length?(ok.length+' barang siap disimpan'+(kosong?' · '+kosong+' kartu belum diberi nama (tidak ikut disimpan)':'')):'';
  }
  function stp(f,val,cls,lbl){
    return `<div class="stp"><button type="button" data-a="dec" data-f="${f}" aria-label="Kurangi">&minus;</button><input class="${cls}" inputmode="numeric" pattern="[0-9]*" value="${val}" aria-label="${lbl}"><button type="button" data-a="inc" data-f="${f}" aria-label="Tambah">+</button></div>`;
  }
  const fmtExp=v=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(v||'');return m?m[3]+'/'+m[2]+'/'+m[1].slice(2):''};
  function moreLbl(r){
    const p=[];if(num(r.min,0)>0)p.push('min '+num(r.min,0));if(r.exp)p.push('exp '+fmtExp(r.exp));
    return 'Detail'+(p.length?' · '+p.join(', '):'')+(r.open?' ▴':' ▾');
  }
  function render(focusLast){
    const have=new Set(rows.map(r=>clean(r.nama).toLowerCase()));
    const quick=std().filter(r=>!have.has(r.nama.toLowerCase()));
    host.innerHTML=(rows.length?rows.map((r,i)=>{
      const units=SATUAN.includes(r.satuan)?SATUAN:SATUAN.concat(r.satuan);
      return `<div class="ir" data-i="${i}"><div class="irn"><input class="in-n" value="${esc(r.nama)}" placeholder="Nama barang, mis. Plester gulung" aria-label="Nama barang" autocomplete="off"><button type="button" class="btn dg" data-a="del" aria-label="Hapus barang ini">Hapus</button></div>
<div class="irg3">${stp('stok',r.stok,'in-s','Jumlah')}<select class="in-u" aria-label="Satuan">${units.map(u=>`<option${u===r.satuan?' selected':''}>${esc(u)}</option>`).join('')}</select><button type="button" class="mre" data-a="more">${esc(moreLbl(r))}</button></div>
<div class="irx"${r.open?'':' hidden'}><div><label>Ingatkan jika sisa kurang dari</label>${stp('min',r.min,'in-m','Stok minimum')}</div><div><label>Kadaluarsa (jika ada)</label><input type="date" class="in-e" value="${esc(r.exp)}"></div></div></div>`}).join('')
      :'<p class="hint">Belum ada barang. Tekan <b>Isi daftar standar</b>, atau <b>+ Tambah barang</b>.</p>')
      +'<div class="iact"><button type="button" class="btn sec iadd" data-a="add">+ Tambah barang</button>'
      +(quick.length?'<select class="qsel" aria-label="Tambah dari daftar standar"><option value="">+ Pilih dari daftar standar…</option>'+quick.map(r=>`<option value="${esc(r.nama)}">${esc(r.nama)}</option>`).join('')+'</select>':'')+'</div>';
    sync();
    if(focusLast){const l=host.querySelectorAll('.in-n');if(l.length)l[l.length-1].focus()}
  }
  host.addEventListener('click',e=>{
    const b=e.target.closest('[data-a]');if(!b)return;
    const a=b.dataset.a,card=b.closest('.ir'),i=card?+card.dataset.i:-1;
    if(a==='add'){rows.push(blank());render(true)}
    else if(a==='del'){rows.splice(i,1);render(false)}
    else if(a==='more'){const r=rows[i];r.open=!r.open;card.querySelector('.irx').hidden=!r.open;b.textContent=moreLbl(r)}
    else if(a==='inc'||a==='dec'){
      const f=b.dataset.f,inp=card.querySelector(f==='stok'?'.in-s':'.in-m');
      const v=Math.max(0,Math.min(99999,num(inp.value,f==='stok'?1:0)+(a==='inc'?1:-1)));
      rows[i][f]=v;inp.value=v;sync();if(f==='min')card.querySelector('.mre').textContent=moreLbl(rows[i]);
    }
  });
  host.addEventListener('input',e=>{
    const t=e.target,card=t.closest('.ir');if(!card)return;const r=rows[+card.dataset.i];
    if(t.classList.contains('in-n'))r.nama=t.value;
    else if(t.classList.contains('in-s')){t.value=t.value.replace(/\D/g,'').slice(0,5);r.stok=t.value}
    else if(t.classList.contains('in-m')){t.value=t.value.replace(/\D/g,'').slice(0,5);r.min=t.value}
    else if(t.classList.contains('in-u'))r.satuan=t.value;
    else if(t.classList.contains('in-e'))r.exp=t.value;
    if(t.classList.contains('in-m')||t.classList.contains('in-e'))card.querySelector('.mre').textContent=moreLbl(r);
    sync();
  });
  host.addEventListener('change',e=>{
    const t=e.target;
    if(t.classList.contains('qsel')){ // tambah cepat dari daftar
      const r=std().find(x=>x.nama===t.value);if(r){rows.push(r);render(false)}
      return;
    }
    const card=t.closest('.ir');if(!card)return;const r=rows[+card.dataset.i];
    if(t.classList.contains('in-s')){r.stok=num(t.value,1);t.value=r.stok;sync()}
    if(t.classList.contains('in-m')){r.min=num(t.value,0);t.value=r.min;sync()}
  });
  render();
  return{
    clear(){rows=[];render()},
    fillStd(){
      if(rows.some(r=>clean(r.nama))&&!confirm('Isi yang sudah ada akan diganti dengan daftar standar. Lanjutkan?'))return;
      rows=std();render();
    }
  };
}
edP3k=makeIsiEditor($('p3kRows'),$('p3kText'),$('p3kCount'));
$('p3kStd').onclick=()=>edP3k.fillStd();
$('p3kClr').onclick=()=>edP3k.clear();

/* ---- status stok ---- */
function isiState(x){
  const d=x.exp?daysTo(x.exp):null;
  return{out:x.stok<=0,low:x.stok>0&&x.min>0&&x.stok<x.min,expd:d!==null&&d<0,soon:d!==null&&d>=0&&d<=SOON,days:d};
}
function isiBadges(x){
  const s=isiState(x),b=[];
  if(s.out)b.push('<span class="bdg er">Habis</span>');else if(s.low)b.push('<span class="bdg wr">Menipis</span>');
  if(s.expd)b.push('<span class="bdg er">Kedaluwarsa</span>');else if(s.soon)b.push('<span class="bdg wr">Exp '+s.days+' hari</span>');
  return b.join(' ');
}
function kotakStat(it){
  let low=0,exp=0;
  (it.isi||[]).forEach(x=>{const s=isiState(x);if(s.out||s.low)low++;if(s.expd||s.soon)exp++});
  return{low,exp};
}

/* ---- toast (tampil di atas dialog yang sedang terbuka) ---- */
let toastT=0;
function toast(t,er){
  let d=$('toast');
  if(!d){d=document.createElement('div');d.id='toast';d.setAttribute('role','status')}
  const host=[...document.querySelectorAll('dialog[open]')].pop()||document.body;
  if(d.parentNode!==host)host.appendChild(d);
  d.textContent=t;d.className='toast'+(er?' er':'');
  void d.offsetWidth;d.classList.add('on');
  clearTimeout(toastT);toastT=setTimeout(()=>d.classList.remove('on'),er?6000:4500);
}

/* ---- operasi ke server / lokal ---- */
async function p3kCall(action,p){ // action: use | add | edit | del | log
  if(API){
    const r=await api(Object.assign({action:'p3k'+action[0].toUpperCase()+action.slice(1)},p));
    if(r.item){const k=items.findIndex(x=>x.kode===r.item.kode);if(k>=0)items[k]=r.item;else items.push(r.item)}
    return r;
  }
  return localP3k(action,p);
}
function localP3k(action,p){ // mode tanpa database bersama (data di browser)
  const it=items.find(i=>i.kode===p.kode);if(!it)throw new Error('Kotak tidak ditemukan');
  const isi=it.isi=it.isi||[],log=it.log=it.log||[],now=Date.now();
  const L=(x,n,t,oleh,cat)=>log.push({waktu:now,item:x.nama,jumlah:n,tipe:t,oleh:oleh||'',cat:cat||'',sisa:x.stok});
  if(action==='log')return{log:log.slice().reverse().slice(0,200)};
  if(action==='use'){
    const plan=[];
    (p.lines||[]).forEach(l=>{
      const n=parseInt(l.jumlah,10);if(!(n>0))return;
      const x=isi.find(y=>y.id===l.id);if(!x)throw new Error('Barang tidak ditemukan di kotak ini');
      if(plan.some(q=>q.x===x))throw new Error('Barang dobel di daftar');
      if(n>x.stok)throw new Error('Stok '+x.nama+' hanya '+x.stok+' '+(x.satuan||''));
      plan.push({x,n});
    });
    if(!plan.length)throw new Error('Isi jumlah yang dipakai');
    plan.forEach(({x,n})=>{x.stok-=n;L(x,n,'pakai',p.oleh,p.cat)});
  }else if(action==='add'){
    (p.list||[]).forEach(c=>{
      const ex=isi.find(y=>nz(y.nama)===nz(c.nama));
      if(ex){ex.stok+=c.stok;if(c.min)ex.min=c.min;if(c.exp)ex.exp=c.exp;if(c.stok)L(ex,c.stok,'isi ulang')}
      else{const x={id:uid(),nama:c.nama,satuan:c.satuan||'pcs',stok:c.stok,min:c.min||0,exp:c.exp||''};isi.push(x);if(x.stok)L(x,x.stok,'tambah')}
    });
  }else if(action==='edit'){
    const x=isi.find(y=>y.id===p.id);if(!x)throw new Error('Barang tidak ditemukan');
    const n=p.item,before=x.stok;
    Object.assign(x,{nama:n.nama,satuan:n.satuan||'pcs',stok:n.stok,min:n.min,exp:n.exp});
    if(n.stok!==before)L(x,n.stok-before,'koreksi');
  }else if(action==='del'){
    const k=isi.findIndex(y=>y.id===p.id);if(k<0)throw new Error('Barang tidak ditemukan');
    isi.splice(k,1);
  }
  if(log.length>300)log.splice(0,log.length-300);
  persist();
  return{item:it};
}
function afterP3k(kode){
  render();
  if($('dlgDetail').open&&dtCur===kode)showDetail(kode);
}

/* ---- panel pemakaian (dipakai di kartu Kotak P3K & di detail hasil scan) ---- */
function p3kUseHTML(it){
  const k=esc(it.kode),isi=(it.isi||[]).slice().sort((a,b)=>a.nama.localeCompare(b.nama));
  if(!isi.length)return `<div class="p3kuse" data-k="${k}"><p class="hint">Kotak ini belum ada isinya. Klik "Tambah isi" untuk memasukkan banyak barang sekaligus.</p></div>`;
  let who='';try{who=localStorage.getItem(LSW)||''}catch(e){}
  const rows=isi.map(x=>`<div class="ir" data-id="${esc(x.id)}"><div class="in"><b>${esc(x.nama)}</b> ${isiBadges(x)}<small>Stok <b>${x.stok}</b> ${esc(x.satuan||'')}${x.min?' · min '+x.min:''}${x.exp?' · exp '+esc(fmtID(x.exp)):''}</small></div><div class="ia"><input class="qn" type="number" min="0" max="${x.stok}" inputmode="numeric" placeholder="0"${x.stok<=0?' disabled':''} aria-label="Jumlah ${esc(x.nama)} yang dipakai"><button type="button" class="btn sec ib" data-ie="${esc(x.id)}" title="Edit" aria-label="Edit ${esc(x.nama)}"><svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button></div></div>`).join('');
  return `<div class="p3kuse" data-k="${k}"><p class="sub">Catat pemakaian</p><div class="irl">${rows}</div><div class="row"><div><label>Dipakai oleh *</label><input class="who" autocomplete="off" placeholder="Nama pemakai" value="${esc(who)}"></div><div><label>Keperluan / catatan</label><input class="note" placeholder="mis. luka ringan di lapangan"></div></div><div class="acts"><button type="button" class="btn p3kgo">Kurangi stok</button></div><div class="res" role="status"></div></div>`;
}
async function p3kSubmit(box,btn){
  const kode=box.dataset.k,it=items.find(i=>i.kode===kode),res=box.querySelector('.res');
  const say=(t,c)=>{res.textContent=t;res.className='res '+c};
  if(!it)return;
  const lines=[...box.querySelectorAll('.ir')].map(r=>({id:r.dataset.id,jumlah:parseInt(r.querySelector('.qn').value,10)||0})).filter(l=>l.jumlah>0);
  const who=box.querySelector('.who').value.trim(),note=box.querySelector('.note').value.trim();
  if(!lines.length){say('Isi jumlah barang yang dipakai.','er');return}
  if(who.length<2){say('Nama pemakai wajib diisi.','er');box.querySelector('.who').focus();return}
  for(const l of lines){const x=(it.isi||[]).find(y=>y.id===l.id);if(x&&l.jumlah>x.stok){say('Stok '+x.nama+' hanya '+x.stok+' '+(x.satuan||'')+'.','er');return}}
  const names=lines.map(l=>{const x=(it.isi||[]).find(y=>y.id===l.id);return(x?x.nama:'?')+' ×'+l.jumlah}).join(', ');
  btn.disabled=true;say('Menyimpan…','mu');
  try{
    const saved=(await p3kCall('use',{kode,lines,oleh:who,cat:note})).item||it;
    try{localStorage.setItem(LSW,who)}catch(e){}
    const warn=lines.map(l=>(saved.isi||[]).find(y=>y.id===l.id)).filter(x=>x&&(x.stok<=0||(x.min>0&&x.stok<x.min))).map(x=>x.nama+(x.stok<=0?' habis':' menipis'));
    afterP3k(kode);
    toast('Tercatat: '+names+' · oleh '+who+(warn.length?' · Perlu isi ulang: '+warn.join(', '):''));
  }catch(err){
    say(err&&err.message||'Gagal menyimpan. Periksa koneksi.','er');btn.disabled=false;
    if(API)refresh().catch(()=>{});
  }
}

/* ---- kartu Kotak P3K ---- */
const p3kOpen=new Set();let p3kSig='';
function snapUse(root){
  const o={};
  root.querySelectorAll('.p3kuse').forEach(b=>{
    const q={};b.querySelectorAll('.ir').forEach(r=>{const v=r.querySelector('.qn').value;if(v)q[r.dataset.id]=v});
    const w=b.querySelector('.who'),n=b.querySelector('.note');
    o[b.dataset.k]={q,who:w?w.value:'',note:n?n.value:''};
  });
  return o;
}
function restoreUse(root,o){
  root.querySelectorAll('.p3kuse').forEach(b=>{
    const s=o[b.dataset.k];if(!s)return;
    b.querySelectorAll('.ir').forEach(r=>{if(s.q[r.dataset.id])r.querySelector('.qn').value=s.q[r.dataset.id]});
    const w=b.querySelector('.who'),n=b.querySelector('.note');
    if(w&&s.who)w.value=s.who;if(n&&s.note)n.value=s.note;
  });
}
const PKI={
  p:'<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/>',
  a:'<path d="M12 5v14M5 12h14"/>',
  r:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  e:'<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  d:'<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'
};
function kotakHTML(it){
  const k=esc(it.kode),st=kotakStat(it),n=(it.isi||[]).length;
  const badges=(st.low?`<span class="bdg wr">${st.low} perlu isi ulang</span>`:'')+(st.exp?`<span class="bdg er">${st.exp} kedaluwarsa/segera</span>`:'');
  const ib=(pk,tt,ic,tx,cls)=>`<button type="button" class="btn ${cls||'sec'} ib" data-pk="${pk}" data-k="${k}" title="${tt}" aria-label="${tt}"><svg viewBox="0 0 24 24">${ic}</svg><span>${tx}</span></button>`;
  return `<details class="kotak" data-k="${k}"${p3kOpen.has(it.kode)?' open':''}><summary><span class="kc">${k}</span><b>${esc(it.nama)}</b><small>${esc(it.lokasi||'tanpa lokasi')} · ${n} jenis isi</small><span class="kb">${badges}</span></summary><div class="kbody">${p3kUseHTML(it)}<div class="acts kact">${ib('label','Cetak label',PKI.p,'Label')}${ib('add','Tambah isi',PKI.a,'Tambah isi')}${ib('log','Riwayat pemakaian',PKI.r,'Riwayat')}${ib('edit','Edit kotak',PKI.e,'Edit')}${ib('del','Hapus kotak',PKI.d,'Hapus','dg')}</div></div></details>`;
}
function renderP3k(){
  const ks=items.filter(i=>isP3K(i.kat)).sort((a,b)=>a.kode.localeCompare(b.kode));
  $('p3kCard').hidden=!(ks.length||Object.keys(CATS).some(isP3K));
  const sig=JSON.stringify(ks.map(k=>[k.kode,k.nama,k.lokasi,k.pic,k.ket,k.diubah,k.isi||[]]));
  if(sig===p3kSig)return; // tidak ada perubahan: jangan gambar ulang (agar isian yang sedang diketik tidak hilang)
  p3kSig=sig;
  const snap=snapUse($('p3kList'));
  let low=0,exp=0;ks.forEach(k=>{const s=kotakStat(k);low+=s.low;exp+=s.exp});
  $('p3kStat').textContent=ks.length+' kotak';
  $('p3kAlerts').innerHTML=(low?`<span class="chip wr static">Perlu isi ulang: <b>${low}</b> barang</span>`:'')+(exp?`<span class="chip er static">Kedaluwarsa / segera: <b>${exp}</b> barang</span>`:'');
  $('p3kEmpty').hidden=ks.length>0;
  $('p3kList').innerHTML=ks.map(kotakHTML).join('');
  restoreUse($('p3kList'),snap);
}
$('p3kList').addEventListener('toggle',e=>{
  const d=e.target;
  if(d.classList&&d.classList.contains('kotak')){if(d.open)p3kOpen.add(d.dataset.k);else p3kOpen.delete(d.dataset.k)}
},true);

document.addEventListener('click',e=>{
  const go=e.target.closest('.p3kgo');if(go){p3kSubmit(go.closest('.p3kuse'),go);return}
  const ie=e.target.closest('[data-ie]');if(ie){openP3kItem(ie.closest('.p3kuse').dataset.k,ie.dataset.ie);return}
  const pk=e.target.closest('[data-pk]');if(!pk)return;
  const k=pk.dataset.k,a=pk.dataset.pk;
  if(a==='label'){const it=items.find(i=>i.kode===k);if(!it)return;lastItem=it;label(it);$('label').scrollIntoView({behavior:'smooth',block:'center'})}
  if(a==='add')openP3kAdd(k);
  if(a==='log')showP3kLog(k);
  if(a==='edit')startEdit(k);
  if(a==='del')delKotak(k);
});
async function delKotak(k){
  const it=items.find(i=>i.kode===k);if(!it)return;
  if(!confirm('Hapus kotak '+k+' ('+it.nama+') beserta seluruh isinya?'))return;
  try{
    if(API)await api({action:'delete',kode:k});
    items=items.filter(i=>i.kode!==k);if(!API)persist();
    if(editing===k)endEdit(true);
    if(lastItem&&lastItem.kode===k){lastItem=null;label(null)}
    p3kOpen.delete(k);render();toast('Dihapus: '+k);
  }catch(err){toast('Gagal menghapus: '+(err&&err.message||'periksa koneksi'),1)}
}

/* ---- dialog: tambah isi (banyak sekaligus) ---- */
let paKode=null;
function openP3kAdd(k){
  const it=items.find(i=>i.kode===k);if(!it)return;
  paKode=k;$('paKode').textContent=k;$('paNama').textContent=it.nama;
  edPa.clear();$('paErr').textContent='';
  $('dlgP3kAdd').showModal();
}
edPa=makeIsiEditor($('paRows'),$('paText'),$('paCount'));
$('paStd').onclick=()=>edPa.fillStd();
$('fP3kAdd').onsubmit=async e=>{
  e.preventDefault();
  const r=parseIsi($('paText').value);
  if(r.errs.length){$('paErr').textContent=r.errs[0]+(r.errs.length>1?' (+'+(r.errs.length-1)+' kesalahan lain)':'');return}
  if(!r.rows.length){$('paErr').textContent='Tulis minimal satu barang.';return}
  const ok=$('paOk');ok.disabled=true;ok.textContent='Menyimpan…';
  try{
    await p3kCall('add',{kode:paKode,list:r.rows});
    $('dlgP3kAdd').close();afterP3k(paKode);
    toast(r.rows.length+' barang ditambahkan ke '+paKode);
  }catch(err){$('paErr').textContent='Gagal menyimpan: '+(err&&err.message||'periksa koneksi')}
  finally{ok.disabled=false;ok.textContent='Tambahkan'}
};

/* ---- dialog: edit satu isi ---- */
let piCur=null;
function openP3kItem(k,id){
  const it=items.find(i=>i.kode===k),x=it&&(it.isi||[]).find(y=>y.id===id);if(!x)return;
  piCur={k,id};$('piKode').textContent=k;
  $('piNama').value=x.nama;$('piStok').value=x.stok;$('piSat').value=x.satuan||'';$('piMin').value=x.min||0;$('piExp').value=x.exp||'';
  $('piErr').textContent='';$('dlgP3kItem').showModal();
}
$('fP3kItem').onsubmit=async e=>{
  e.preventDefault();if(!piCur)return;
  const nama=$('piNama').value.trim();
  if(!nama){$('piErr').textContent='Nama barang wajib diisi.';return}
  const n=v=>Math.max(0,Math.min(99999,parseInt(v,10)||0));
  const item={nama,satuan:$('piSat').value.trim()||'pcs',stok:n($('piStok').value),min:n($('piMin').value),exp:$('piExp').value||''};
  const ok=$('piOk');ok.disabled=true;
  try{await p3kCall('edit',{kode:piCur.k,id:piCur.id,item});$('dlgP3kItem').close();afterP3k(piCur.k);toast('Isi kotak diperbarui')}
  catch(err){$('piErr').textContent='Gagal menyimpan: '+(err&&err.message||'periksa koneksi')}
  finally{ok.disabled=false}
};
$('piDel').onclick=async()=>{
  if(!piCur||!confirm('Hapus "'+$('piNama').value+'" dari kotak ini?'))return;
  try{await p3kCall('del',{kode:piCur.k,id:piCur.id});$('dlgP3kItem').close();afterP3k(piCur.k);toast('Dihapus dari kotak')}
  catch(err){$('piErr').textContent='Gagal menghapus: '+(err&&err.message||'periksa koneksi')}
};

/* ---- dialog: riwayat pemakaian ---- */
const LOGT={pakai:'Dipakai','isi ulang':'Isi ulang',tambah:'Isi awal',koreksi:'Koreksi'};
async function showP3kLog(k){
  $('plKode').textContent=k;$('plBody').innerHTML='<p class="hint">Memuat…</p>';
  if(!$('dlgP3kLog').open)$('dlgP3kLog').showModal();
  try{
    const rows=(await p3kCall('log',{kode:k})).log||[];
    const amt=x=>x.tipe==='pakai'?'−'+Math.abs(x.jumlah):(x.jumlah>0?'+':'')+x.jumlah;
    $('plBody').innerHTML=rows.length
      ?`<div class="tw"><table><thead><tr><th>Waktu</th><th>Jenis</th><th>Barang</th><th>Jumlah</th><th>Oleh</th><th>Catatan</th><th>Sisa</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(fmtDT(+x.waktu))}</td><td>${esc(LOGT[x.tipe]||x.tipe)}</td><td>${esc(x.item)}</td><td>${esc(amt(x))}</td><td>${esc(x.oleh)}</td><td>${esc(x.cat)}</td><td>${esc(x.sisa)}</td></tr>`).join('')}</tbody></table></div>`
      :'<p class="hint">Belum ada pemakaian tercatat.</p>';
  }catch(err){$('plBody').innerHTML='<p class="err">Gagal memuat: '+esc(err&&err.message||'periksa koneksi')+'</p>'}
}

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
