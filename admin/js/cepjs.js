/* ===== CEP -> ViaCEP (auto-preenchimento) ===== */
(function cepAuto(){
  const cepEl = document.getElementById('cep');
  if(!cepEl) return;

  const logEl = document.getElementById('logradouro');
  const baiEl = document.getElementById('bairro');
  const cidEl = document.getElementById('cidade');
  const ufEl  = document.getElementById('uf');

  function onlyDigits(s){ return (s||'').replace(/\D/g,''); }
  function maskCep(v){
    v = onlyDigits(v).slice(0,8);
    return v.length>5 ? v.slice(0,5)+'-'+v.slice(5) : v;
  }
  function fill(d){
    logEl.value = d.logradouro || '';
    baiEl.value = d.bairro     || '';
    cidEl.value = d.localidade || '';
    ufEl.value  = d.uf         || '';
    saveDraft();
  }
  async function lookup(){
    const raw = onlyDigits(cepEl.value);
    if(raw.length!==8) return;
    try{
      const r = await fetch(`https://viacep.com.br/ws/${raw}/json/`);
      const j = await r.json();
      if(j.erro){ throw new Error('CEP não encontrado'); }
      fill(j);
    }catch(e){
      // limpa se inválido
      fill({logradouro:'',bairro:'',localidade:'',uf:''});
      console.warn('ViaCEP:', e.message);
    }
  }

  cepEl.addEventListener('input', (e)=>{
    const caret = e.target.selectionStart;
    e.target.value = maskCep(e.target.value);
    // busca automática quando completou 8 dígitos
    if(onlyDigits(e.target.value).length===8) lookup();
  });
  cepEl.addEventListener('blur', lookup);
})();
