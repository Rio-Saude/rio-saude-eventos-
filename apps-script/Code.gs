/*
 * Rio Saúde — cadastro inicial independente (V1).
 * Fonte: questionário em simplified-registration.js e PAR-Q em parq.js.
 * Não integra Supabase, cobrança, TrainingPeaks, área do aluno ou calendário.
 *
 * CONFIGURAÇÃO: substituir a constante SHEET_ID pelo ID da planilha PRIVADA
 * aprovada para o cadastro inicial. Nunca apontar para a planilha histórica
 * compartilhada publicamente.
 */
const SHEET_ID = '1MmK-VEP9S8hULIK9rszzRKlMTk--hoitsE2NJrB2piU';
const TAB_NAME = 'Respostas cadastro inicial';
const VERSION = 'cadastro_inicial_v1_20261023';
const HEADERS = [
  'Recebido em', 'Nome', 'Sobrenome', 'E-mail', 'WhatsApp',
  'Nascimento', 'Cidade', 'Modalidades', 'Experiência', 'Nível atual',
  'Dias que treina hoje', 'Dias disponíveis', 'Base de treino',
  'Lesão anterior', 'Detalhes da lesão', 'Objetivo principal',
  'Provas de interesse', 'Triagem 1', 'Triagem 2', 'Triagem 3',
  'Triagem 4', 'Triagem 5', 'Triagem 6', 'Triagem 7', 'Triagem 8',
  'Triagem 9', 'Triagem 10', 'Alguma resposta Sim?',
  'Respostas verdadeiras confirmadas', 'Menor de idade',
  'Nome do responsável', 'Autorização do responsável', 'Versão'
];

function doGet() {
  const template = HtmlService.createTemplateFromFile('Cadastro');
  const nonce = Utilities.getUuid();
  CacheService.getScriptCache().put('rs-v1-' + nonce, '1', 21600);
  template.nonce = nonce;
  return template.evaluate()
    .setTitle('Rio Saúde | Cadastro inicial')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function salvarCadastro(form) {
  if (!form || typeof form !== 'object') throw new Error('Dados inválidos.');
  const texto = (key, max) => {
    const value = String(form[key] == null ? '' : form[key]).trim();
    if (value.length > max) throw new Error('O campo ' + key + ' está muito longo.');
    return value;
  };
  const nome = texto('first_name', 100), sobrenome = texto('last_name', 100);
  const email = texto('email', 180).toLowerCase();
  const telefone = texto('whatsapp', 40), nascimento = texto('birth_date', 10);
  const cidade = texto('city', 100);
  if (!nome || !sobrenome || !telefone || !cidade ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(nascimento)) {
    throw new Error('Confira seus dados pessoais.');
  }
  const nasc = new Date(nascimento + 'T12:00:00Z');
  if (!Number.isFinite(nasc.getTime()) ||
      nasc.toISOString().slice(0, 10) !== nascimento) {
    throw new Error('Data de nascimento inválida.');
  }
  const hoje = new Date();
  let idade = hoje.getUTCFullYear() - nasc.getUTCFullYear();
  const mesDia = (hoje.getUTCMonth() + 1) * 100 + hoje.getUTCDate();
  const aniversario = (nasc.getUTCMonth() + 1) * 100 + nasc.getUTCDate();
  if (mesDia < aniversario) idade--;
  if (idade < 0 || idade > 120) throw new Error('Data de nascimento inválida.');
  const menor = idade < 18;
  const responsavel = texto('guardian_name', 160);
  if (menor && (!responsavel || form.guardian_authorization !== true)) {
    throw new Error('O responsável precisa autorizar o cadastro do menor.');
  }
  if (form.confirm_truth !== true) throw new Error('Confirme suas respostas.');
  const modalidadesValidas = ['corrida', 'triathlon', 'trail', 'natacao', 'ciclismo'];
  const modalidades = Array.isArray(form.modalities)
    ? [...new Set(form.modalities.map(String))] : [];
  if (!modalidades.length || modalidades.some(x => !modalidadesValidas.includes(x))) {
    throw new Error('Selecione pelo menos uma modalidade.');
  }
  const experiencia = texto('running_experience', 60);
  const diasDisponiveis = texto('training_days_available', 30);
  const base = texto('base_preference', 40);
  const lesao = texto('injury', 5);
  if (!experiencia || !diasDisponiveis || !base ||
      !['yes', 'no'].includes(lesao)) {
    throw new Error('Confira seu perfil esportivo.');
  }
  const screening = [];
  for (let i = 1; i <= 10; i++) {
    if (!['yes', 'no'].includes(form['q' + i])) {
      throw new Error('Responda às dez perguntas de saúde.');
    }
    screening.push(form['q' + i] === 'yes');
  }
  const algumSim = screening.some(Boolean);
  const nonce = texto('nonce', 80);
  if (!/^[\da-f-]{36}$/i.test(nonce)) throw new Error('Sessão inválida.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Servidor ocupado. Tente novamente.');
  try {
    const cache = CacheService.getScriptCache();
    if (cache.get('rs-v1-' + nonce) !== '1') {
      throw new Error('Este cadastro já foi enviado ou a sessão expirou. Atualize a página.');
    }
    if (SHEET_ID === 'CONFIGURAR_PLANILHA_PRIVADA_ANTES_DE_TESTAR') {
      throw new Error('Planilha de destino ainda não configurada.');
    }
    const sheetDoc = SpreadsheetApp.openById(SHEET_ID);
    let sheet = sheetDoc.getSheetByName(TAB_NAME);
    if (!sheet) sheet = sheetDoc.insertSheet(TAB_NAME);
    if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
    if (sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0].join('|') !== HEADERS.join('|')) {
      throw new Error('Cabeçalho da planilha diferente do esperado. Nenhum dado foi alterado.');
    }
    const seguro = value => {
      const str = String(value == null ? '' : value);
      return /^[\s]*[=+\-@]/.test(str) ? "'" + str : str;
    };
    const row = [
      new Date(), nome, sobrenome, email, telefone, nascimento, cidade,
      modalidades.join(', '), experiencia, texto('current_level', 40),
      texto('training_days_current', 50), diasDisponiveis, base,
      lesao === 'yes' ? 'Sim' : 'Não',
      lesao === 'yes' ? texto('training_injury_details', 1800) : '',
      texto('primary_goal', 2000), texto('goal_events', 2000),
      ...screening.map(x => x ? 'Sim' : 'Não'), algumSim ? 'Sim' : 'Não',
      'Sim', menor ? 'Sim' : 'Não', menor ? responsavel : '',
      menor ? 'Sim' : 'Não', VERSION
    ].map((v, i) => i === 0 ? v : seguro(v));
    sheet.appendRow(row);
    cache.remove('rs-v1-' + nonce);
    return { ok: true, medicalReviewRecommended: algumSim };
  } finally {
    lock.releaseLock();
  }
}