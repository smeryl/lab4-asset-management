// =====================================================================
// Supabase connection config
// Get these two values from: Supabase Dashboard -> Project Settings -> API
// =====================================================================
const SUPABASE_URL = "https://iamgumjzesiygxtcawfa.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlhbWd1bWp6ZXNpeWd4dGNhd2ZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0MDI4MzAsImV4cCI6MjEwNDk3ODgzMH0.CYKoodh6ubb9duFNqx0HJ_yRxFXxnXgRm3Ea1jQHC7k";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
