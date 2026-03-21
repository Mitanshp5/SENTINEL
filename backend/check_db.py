import asyncio
from motor.motor_asyncio import AsyncIOMotorClient

async def check():
    client = AsyncIOMotorClient('mongodb://127.0.0.1:27017')
    db = client.sentinel
    active = await db.incidents.find({"status": "active"}).to_list(100)
    for inc in active:
        print(f"ID: {inc['_id']} - ASSIGNED: {inc.get('assigned_operator')} - CITY: {inc.get('city')}")

asyncio.run(check())
