import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CONFIG, configIsComplete } from '../config.js';

// Клиент создаём только если конфиг заполнен, иначе createClient бросит
// исключение и приложение упадёт с пустым экраном.
export let supabase = null;
export let supabaseInitError = null;

if (configIsComplete()) {
  try {
    supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        storage: localStorage
      }
    });
  } catch (e) {
    supabaseInitError = e;
  }
}

// Получаем текущего пользователя вместе с профилем.
// profile может отсутствовать (триггер в базе ещё не создан) — возвращаем null,
// а не падаем, чтобы интерфейс мог показать понятное сообщение.
export async function getCurrentUser() {
  if (!supabase) return null;

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;

  let profile = null;
  try {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();
    profile = data || null;
  } catch (e) {
    profile = null;
  }

  return { ...user, profile };
}

// Получаем все профили пользователей (для списков участников)
export async function getAllProfiles() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('username', { ascending: true });

  if (error) throw error;
  return data || [];
}
