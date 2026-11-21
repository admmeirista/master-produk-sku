const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function loading(){
 const nodes={},root={inert:false,setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];}},main={busy:true,querySelector(){return this.busy?{}:null;}};nodes.app=root;nodes.main=main;nodes['auth-loading-message']={};let changed,disconnected=0,now=0,serial=0;const timers=new Map();function advance(ms){const end=now+ms;while(true){const next=[...timers.entries()].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=end;}
 const c={Date:{now:()=>now},brandLogo:()=>'<img>',esc:String,document:{getElementById:id=>nodes[id],createElement:()=>({querySelector(){return {appendChild:el=>nodes.welcomeButton=el};},setAttribute(){},remove(){delete nodes[this.id];}}),body:{appendChild:el=>nodes[el.id]=el}},MutationObserver:class{constructor(fn){changed=fn;}observe(){}disconnect(){disconnected++;}},setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(fs.readFileSync('apps-script/src/AuthLoading.html','utf8').replace(/^<script>\s*/,'').replace(/<\/script>\s*$/,''),c);
 return {c,nodes,root,main,change:()=>changed(),advance,timeout:()=>advance(12000),disconnected:()=>disconnected};
}
test('layar pemuatan mengunci form, mengikuti pemuatan halaman, dan membersihkan observer setelah halaman siap',()=>{
 const {c,nodes,root,main,change,advance,disconnected}=loading();c.AuthLoading.show('Memeriksa akun');assert.ok(nodes['auth-loading']);assert.equal(root.inert,true);assert.equal(root['aria-busy'],'true');c.AuthLoading.finish();assert.equal(nodes['auth-loading-message'].textContent,'Menyiapkan ruang kerja…');assert.ok(nodes['auth-loading']);main.busy=false;change();assert.ok(nodes['auth-loading']);advance(3499);assert.ok(nodes['auth-loading']);advance(1);assert.equal(nodes['auth-loading'],undefined);assert.equal(root.inert,false);assert.equal(root['aria-busy'],undefined);assert.equal(disconnected(),1);
});
test('pemuatan data yang lambat tidak membuat pengguna terkunci; hide pada kegagalan selalu mengembalikan form',()=>{
 const {c,nodes,root,timeout}=loading();c.AuthLoading.show();c.AuthLoading.finish();timeout();assert.equal(nodes['auth-loading'],undefined);assert.equal(root.inert,false);c.AuthLoading.show();c.AuthLoading.hide();assert.equal(root.inert,false);assert.equal(nodes['auth-loading'],undefined);
});
test('durasi minimum dihitung sejak layar muncul; respons lambat tidak ditambah jeda, dan kegagalan membatalkan timer',()=>{
 const {c,nodes,main,change,advance}=loading();c.AuthLoading.show();c.AuthLoading.finish();advance(4000);main.busy=false;change();assert.equal(nodes['auth-loading'],undefined,'halaman siap setelah 4 detik langsung ditampilkan');
 c.AuthLoading.show();main.busy=false;c.AuthLoading.finish();advance(500);c.AuthLoading.hide();assert.equal(nodes['auth-loading'],undefined,'pesan gagal tidak ditunda');c.AuthLoading.show();advance(1500);assert.ok(nodes['auth-loading'],'timer lama tidak boleh menutup percobaan berikutnya');c.AuthLoading.hide();
});
function login(){
 const events=[],requests=[],button={disabled:false,classList:{add(){},remove(){}}},error={},form={email:{value:'user@local.test',focus(){}},password:{value:'password',focus(){}},isConnected:true};
 const c={document:{getElementById:id=>id==='lf'?form:null},brand:()=>'',icon:()=>'',errBox:m=>'error:'+m,$:selector=>selector==='.cta'?button:error,Store:{set(){}},AuthLoading:{hide:()=>events.push('hide'),show:()=>events.push('show'),message:()=>events.push('account'),finish:()=>events.push('finish')},api:(action,payload)=>new Promise((resolve,reject)=>requests.push({action,payload,resolve,reject}))};
 const source=fs.readFileSync('apps-script/src/Scripts.html','utf8'),start=source.indexOf('  showLogin: function'),end=source.indexOf('  bindEye:',start);vm.runInNewContext('var App={'+source.slice(start,end)+'};',c);Object.assign(c.App,{authShell(){},bindEye(){},remember(){events.push('remember');},enter(){events.push('enter');}});c.App.showLogin();events.length=0;return {c,events,requests,form,button,error};
}
const flush=()=>new Promise(setImmediate);
test('login menampilkan layar pemuatan, menolak klik ganda, dan menyiapkan ruang kerja hanya setelah hak akses diterima',async()=>{
 const {c,events,requests,form}=login();form.onsubmit({preventDefault(){}});form.onsubmit({preventDefault(){}});assert.equal(requests.length,1);assert.equal(requests[0].action,'auth.login');assert.deepEqual(events,['show']);requests[0].resolve({token:'local-test'});await flush();assert.equal(requests[1].action,'auth.me');assert.deepEqual(events,['show','account']);requests[1].resolve({user:{id:'u'}});await flush();assert.deepEqual(events,['show','account','remember','enter','finish']);
});
test('login gagal menutup layar pemuatan dan menampilkan pesan kesalahan pada form yang dapat dipakai ulang',async()=>{
 const {events,requests,form,button,error}=login();form.onsubmit({preventDefault(){}});requests[0].reject({message:'Username atau password salah'});await flush();assert.equal(events.at(-1),'hide');assert.equal(button.disabled,false);assert.equal(form.password.value,'');assert.equal(form.email.value,'user@local.test');assert.match(error.innerHTML,/Username atau password salah/);
});

test('sesi tersimpan tetap menampilkan animasi minimum saat masuk kembali',()=>{
 const events=[],source=fs.readFileSync('apps-script/src/Scripts.html','utf8'),start=source.indexOf('  start: function () {',source.indexOf('var App =')),end=source.indexOf('  remember:',start);
 const c={Store:{get:()=>JSON.stringify({user:{id:'cached'}})},AuthLoading:{show:()=>events.push('show'),finish:()=>events.push('finish')},api:()=>new Promise(()=>{})};
 vm.runInNewContext('var App={token:"saved",'+source.slice(start,end)+'};',c);c.App.enter=()=>events.push('enter');c.App.start();assert.deepEqual(events,['show','enter','finish']);
});

test('layar sambutan menunggu animasi dan klik eksplisit sebelum membuka form login',()=>{
 const {c,nodes,advance,root}=loading();let calls=0;c.AuthLoading.welcome(()=>calls++);const button=nodes.welcomeButton;
 assert.equal(button.disabled,true);button.onclick();assert.equal(calls,0);advance(3499);assert.equal(button.disabled,true);advance(1);assert.equal(button.disabled,false);advance(10000);assert.ok(nodes['auth-loading'],'tidak pindah otomatis setelah animasi');assert.equal(calls,0);
 button.onclick();assert.equal(calls,1);assert.equal(nodes['auth-loading'],undefined);assert.equal(root.inert,false);button.onclick();assert.equal(calls,1,'klik berulang tidak membuka form lagi');
});
test('timer sambutan yang dibatalkan tidak mengganggu pemuatan login berikutnya',()=>{
 const {c,nodes,advance}=loading();let calls=0;c.AuthLoading.welcome(()=>calls++);const old=nodes.welcomeButton;c.AuthLoading.hide();c.AuthLoading.show();advance(4000);old.onclick();assert.equal(calls,0);assert.ok(nodes['auth-loading']);
});
test('tanpa sesi: tombol sambutan menjadi gerbang ke form login',()=>{
 const events=[],source=fs.readFileSync('apps-script/src/Scripts.html','utf8'),start=source.indexOf('  start: function () {',source.indexOf('var App =')),end=source.indexOf('  remember:',start);let next;
 const c={AuthLoading:{welcome:fn=>{events.push('welcome');next=fn;}},api:()=>Promise.resolve({})};vm.runInNewContext('var App={token:null,'+source.slice(start,end)+'};',c);c.App.showLogin=()=>events.push('login');c.App.start();assert.deepEqual(events,['welcome']);next();assert.deepEqual(events,['welcome','login']);
});
