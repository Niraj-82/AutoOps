import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL") or "http://localhost:54321"
SUPABASE_KEY = os.getenv("SUPABASE_KEY") or "dummy"

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)