/*
 * Configuração do Supabase.
 *
 * Enquanto os valores abaixo forem os placeholders, o app funciona
 * normalmente em modo local (dados salvos só neste navegador, via localStorage).
 *
 * Para ativar a sincronização na nuvem:
 *   1. Crie um projeto em https://supabase.com
 *   2. Rode o conteúdo de supabase/schema.sql no SQL Editor do projeto
 *   3. Em Project Settings > API, copie a "Project URL" e a chave "anon public"
 *   4. Cole os valores abaixo
 *
 * A chave "anon" é pública por design (protegida pelas políticas de RLS
 * criadas pelo schema.sql) — não é um segredo, mas trate a URL do projeto
 * como identificadora do seu banco.
 */
window.SUPABASE_CONFIG = {
  url: 'https://kgvbcpdhizceiktoejtl.supabase.co',
  anonKey: 'sb_publishable_c-ODyIycXYclUKXMvrdZ3Q_iEkvhc2k',
};
