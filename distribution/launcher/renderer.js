const button = document.querySelector('#scan');
button.addEventListener('click', async () => {
  button.disabled = true;
  document.querySelector('#status').textContent = 'Verificando componentes…';
  const list = document.querySelector('#results');
  list.replaceChildren();
  try {
    const r = await window.nexoDiagnostics.inspect();
    const rows = [['Sistema', `${r.platform} / ${r.arch}`], ['CPU', `${r.cpu} · ${r.cores} processadores lógicos`], ['RAM total', `${r.totalGiB} GB`], ['RAM disponível', `${r.freeGiB} GB`], ['Disco disponível', r.diskFreeGiB === null ? 'Não verificado' : `${r.diskFreeGiB} GB`], ['Classificação', r.assessment.tier], ['Runtime interno', `${r.runtime} — ${r.runtimeNote}`], ['Java', r.java.detail], ['Android SDK', r.sdk.detail], ['ADB', r.adb.detail], ['Aceleração', r.acceleration.detail], ['Worker', r.worker.detail]];
    for (const [label, value] of rows) {
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd'); dd.textContent = value;
      list.append(dt, dd);
    }
    document.querySelector('#status').textContent = 'Verificação concluída. Componentes ausentes exigem instalação separada.';
  } catch { document.querySelector('#status').textContent = 'Não foi possível concluir a verificação. Tente novamente.'; }
  finally { button.disabled = false; }
});
