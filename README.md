# Meu Financeiro

App web local para controlar seus gastos mensais — inspirado no seu Atalho de iOS "Registrar Gastos".

## Como usar

Abra `index.html` no navegador (duplo clique funciona). Não precisa de instalação nem servidor.

Por padrão, os dados ficam salvos só no navegador (localStorage), no seu computador. Se limpar os dados do navegador, os lançamentos somem — por isso, exporte um backup de vez em quando em **Configurações → Exportar backup (JSON)**, ou ative a sincronização na nuvem (veja abaixo).

## Sincronizar com Supabase (opcional)

Sem configurar nada, o app funciona 100% local. Para sincronizar seus dados entre celular/computador com login por e-mail e senha, conecte um projeto Supabase:

1. Crie uma conta e um projeto em [supabase.com](https://supabase.com) (grátis).
2. No projeto, abra **SQL Editor** e rode o conteúdo do arquivo [`supabase/schema.sql`](supabase/schema.sql) deste repositório — isso cria as tabelas e as políticas de segurança (cada usuário só vê os próprios dados).
3. Em **Project Settings → API**, copie a **Project URL** e a chave **anon public** (ou **publishable**, no dashboard novo).
4. Abra o arquivo [`config.js`](config.js) e cole os dois valores em `window.SUPABASE_CONFIG`.
5. Em **Authentication → Providers → Email**, desative **"Confirm email"**. Como é um app de uso pessoal, isso evita qualquer etapa por e-mail no login — sem isso, criar conta exigiria clicar num link de confirmação, o que abre o Safari normal em vez do atalho salvo na tela de início do iPhone.
6. Recarregue o site. Na tela de login, digite seu e-mail e uma senha e clique em **"Criar conta (primeiro acesso)"** — só precisa fazer isso uma vez. Nas próximas vezes, use **"Entrar"**.

Depois de logado, o Supabase mantém a sessão salva no navegador — não pede login de novo a cada abertura, só se você sair (botão "Sair") ou limpar os dados do navegador.

A chave "anon"/"publishable" é pública por design (protegida pelas políticas de RLS do schema) — não precisa tratá-la como segredo, mas evite comitar a URL do projeto se preferir manter tudo privado. **Nunca coloque sua senha em nenhum arquivo do repositório** — ela só deve ser digitada na tela de login.

## O que tem

- **Dashboard** — receitas, despesas, saldo do mês, gastos por categoria e por forma de pagamento, comparação com o mês anterior.
- **Transações** — adicionar/editar/excluir lançamentos (igual ao Atalho: valor, categoria, forma de pagamento, descrição, data), com filtros e busca.
- **Orçamentos** — defina um limite mensal por categoria e acompanhe o progresso.
- **Assinaturas** — cadastre gastos recorrentes (Netflix, academia, etc.) e lance com um clique todo mês.
- **Metas** — reserva de emergência, viagem, o que quiser: defina um alvo e vá contribuindo.
- **Calculadora CDI** — quanto seu saldo rende passivamente (por dia/mês/ano) e um simulador de investimento com aportes mensais, taxa de CDI editável e estimativa de IR.
- **Configurações** — editar categorias e formas de pagamento (mesma lógica de listas do Atalho), tema claro/escuro, exportar/importar CSV e backup completo.

## Categorias e formas de pagamento padrão

As mesmas do seu Atalho — edite livremente em Configurações:

- Categorias: Luz, Saídas / Namoro, Investimentos, Roupas / Compras, Presentes, Mercado, Transporte, Assinaturas, Saúde / Cuidados, Outros
- Formas de pagamento: PIX, Crédito, Débito, Vale Alimentação, Dinheiro

## Importar seu Gastos.csv do Atalho

Em **Transações → Importar CSV**, aceita o formato `Data;Valor;Categoria;Forma de Pagamento;Descrição` (com `;` como separador, igual ao que o Atalho gera).
