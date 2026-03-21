import asyncio
from motor.motor_asyncio import AsyncIOMotorClient

async def main():
    uri = "mongodb+srv://pranshulsoni2006marvel_db_user:vdTSdb1rrmPVFdSI@sentinel.worgkrj.mongodb.net/?appName=SENTINEL"
    client = AsyncIOMotorClient(uri)
    db = client.traffic_copilot
    
    # Delete random incidents (source equal to "incident")
    res = await db.incidents.delete_many({"source": {"$ne": "demo_injection"}})
    print(f"Deleted {res.deleted_count} incidents")
    client.close()

asyncio.run(main())
