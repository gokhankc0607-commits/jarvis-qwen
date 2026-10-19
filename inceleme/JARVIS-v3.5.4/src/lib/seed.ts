import { db } from "@/db";
import { ensureKanal, ensureKanalStrategies } from "./kanalStore";
import {
  accountState,
  strategies,
  compileJobs,
  signals,
  trades,
  watchRules,
  aiProviders,
  messages,
} from "@/db/schema";

export const RSI_CCI_EA = `//+------------------------------------------------------------------+
//|                                            Jarvis_RSI_CCI.mq5    |
//|                         JARVIS - Osilatör Uyumsuzluk Stratejisi  |
//+------------------------------------------------------------------+
#property copyright "JARVIS"
#property version   "1.30"
#property strict

#include <Trade\\Trade.mqh>

input int    InpRSIPeriod   = 14;
input double InpRSIOver     = 70.0;
input double InpRSIUnder    = 30.0;
input int    InpCCIPeriod   = 20;
input double InpCCILevel    = 100.0;
input double InpLots        = 0.10;
input int    InpSLPoints    = 300;
input int    InpTPPoints    = 600;
input ulong  InpMagic       = 770077;

CTrade  trade;
int     hRSI = INVALID_HANDLE;
int     hCCI = INVALID_HANDLE;

int OnInit()
  {
   hRSI = iRSI(_Symbol, _Period, InpRSIPeriod, PRICE_CLOSE);
   hCCI = iCCI(_Symbol, _Period, InpCCIPeriod, PRICE_TYPICAL);
   if(hRSI == INVALID_HANDLE || hCCI == INVALID_HANDLE)
      return(INIT_FAILED);
   trade.SetExpertMagicNumber(InpMagic);
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason)
  {
   IndicatorRelease(hRSI);
   IndicatorRelease(hCCI);
  }

bool HasPosition()
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(PositionSelectByTicket(t) && PositionGetInteger(POSITION_MAGIC) == (long)InpMagic
         && PositionGetString(POSITION_SYMBOL) == _Symbol)
         return(true);
     }
   return(false);
  }

void OnTick()
  {
   static datetime lastBar = 0;
   datetime bar = iTime(_Symbol, _Period, 0);
   if(bar == lastBar) return;
   lastBar = bar;

   double rsi[], cci[];
   ArraySetAsSeries(rsi, true);
   ArraySetAsSeries(cci, true);
   if(CopyBuffer(hRSI, 0, 0, 3, rsi) < 3) return;
   if(CopyBuffer(hCCI, 0, 0, 3, cci) < 3) return;
   if(HasPosition()) return;

   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);

   if(rsi[2] < InpRSIUnder && rsi[1] > InpRSIUnder && cci[1] < -InpCCILevel)
      trade.Buy(InpLots, _Symbol, ask, ask - InpSLPoints * _Point, ask + InpTPPoints * _Point, "JARVIS BUY");

   if(rsi[2] > InpRSIOver && rsi[1] < InpRSIOver && cci[1] > InpCCILevel)
      trade.Sell(InpLots, _Symbol, bid, bid + InpSLPoints * _Point, bid - InpTPPoints * _Point, "JARVIS SELL");
  }
//+------------------------------------------------------------------+
`;

export const SMC_EA = `//+------------------------------------------------------------------+
//|                                              Jarvis_SMC_OB.mq5   |
//|               JARVIS - Smart Money Concepts Order Block taslağı  |
//+------------------------------------------------------------------+
#property copyright "JARVIS"
#property version   "0.90"

#include <Trade\\Trade.mqh>

input int    InpSwingLookback = 20;
input double InpLots          = 0.05;
input ulong  InpMagic         = 880088;

CTrade trade;

int OnInit()
  {
   trade.SetExpertMagicNumber(InpMagic);
   return(INIT_SUCCEEDED);
  }

double SwingHigh()
  {
   int idx = iHighest(_Symbol, _Period, MODE_HIGH, InpSwingLookback, 2);
   return iHigh(_Symbol, _Period, idx);
  }

double SwingLow()
  {
   int idx = iLowest(_Symbol, _Period, MODE_LOW, InpSwingLookback, 2);
   return iLow(_Symbol, _Period, idx)
  }

void OnTick()
  {
   double close1 = iClose(_Symbol, _Period, 1);
   // Break of structure
   if(close1 > SwingHigh())
      Print("BOS yukarı: ", close1);
   if(close1 < SwingLow())
      Print("BOS aşağı: ", close1);
  }
//+------------------------------------------------------------------+
`;

export const GANN_EA = `//+------------------------------------------------------------------+
//|                                            Jarvis_Gann_Grid.mq5  |
//|                           JARVIS - Gann açı seviyeleri göstergesi |
//+------------------------------------------------------------------+
#property copyright "JARVIS"
#property version   "0.50"

input double InpPivot = 0.0;   // 0 = son swing low
input double InpStep  = 0.0025;

int OnInit()
  {
   return(INIT_SUCCEEDED);
  }

void OnTick()
  {
   double pivot = InpPivot > 0 ? InpPivot : iLow(_Symbol, PERIOD_D1, 1);
   for(int i = 1; i <= 8; i++)
     {
      string name = "GANN_" + IntegerToString(i);
      double lvl = pivot + InpStep * MathSqrt(i);
      if(ObjectFind(0, name) < 0)
         ObjectCreate(0, name, OBJ_HLINE, 0, 0, lvl);
      else
         ObjectSetDouble(0, name, OBJPROP_PRICE, lvl);
     }
  }
`;

const min = (m: number) => new Date(Date.now() - m * 60000);

export async function seedUser(userId: number) {
  await db.insert(accountState).values({
    userId,
    connected: false,
    server: "ICMarketsSC-Demo",
    login: "51234567",
    balance: 25000,
    equity: 25412.6,
    margin: 1180.4,
    freeMargin: 24232.2,
    currency: "USD",
    leverage: 500,
  }).onConflictDoNothing();

  const [s1] = await db.insert(strategies).values([
    {
      userId,
      name: "Jarvis RSI/CCI Uyumsuzluk",
      filePath: "MQL5\\Experts\\Jarvis\\Jarvis_RSI_CCI.mq5",
      description: "RSI aşırı alım/satım dönüşleri + CCI filtresi ile giriş.",
      code: RSI_CCI_EA,
      version: 13,
      status: "compiled",
      lastCompiledAt: min(42),
    },
    {
      userId,
      name: "Jarvis SMC Order Block",
      filePath: "MQL5\\Experts\\Jarvis\\Jarvis_SMC_OB.mq5",
      description: "BOS / CHoCH tespiti ve order block bölgeleri (taslak).",
      code: SMC_EA,
      version: 4,
      status: "error",
      lastCompiledAt: min(15),
    },
    {
      userId,
      name: "Jarvis Gann Grid",
      filePath: "MQL5\\Experts\\Jarvis\\Jarvis_Gann_Grid.mq5",
      description: "Günlük pivot üzerinden Gann karekök seviyeleri.",
      code: GANN_EA,
      version: 2,
      status: "draft",
    },
  ]).returning();

  const all = await db.select({ id: strategies.id, name: strategies.name }).from(strategies);
  const smc = all.find((s) => s.name.includes("SMC"));

  await db.insert(compileJobs).values([
    {
      userId,
      strategyId: s1.id,
      status: "success",
      attempt: 2,
      errors: 0,
      warnings: 0,
      source: "agent",
      log: `[Deneme 1] Jarvis_RSI_CCI.mq5(71,4) : error 256: 'trade' - undeclared identifier
[Otonom düzeltme] LLM: CTrade nesnesi tanımlandı, #include <Trade\\Trade.mqh> eklendi.
[Deneme 2] Result: 0 errors, 0 warnings, 812 msec elapsed
Jarvis_RSI_CCI.ex5 oluşturuldu.`,
      createdAt: min(43),
      finishedAt: min(42),
    },
    {
      userId,
      strategyId: smc?.id ?? s1.id,
      status: "failed",
      attempt: 1,
      autoFix: false,
      errors: 1,
      warnings: 0,
      source: "demo",
      log: `Jarvis_SMC_OB.mq5(33,4) : error 143: ';' - expected
Result: 1 errors, 0 warnings`,
      createdAt: min(15),
      finishedAt: min(15),
    },
  ]);

  await db.insert(watchRules).values([
    { userId, symbol: "EURUSD", timeframe: "M15,H1,H4", lotSize: 0.1 },
    { userId, symbol: "GBPUSD", timeframe: "M15,H1", lotSize: 0.1 },
    { userId, symbol: "XAUUSD", timeframe: "M5,M15,H1", rsiOverbought: 75, rsiOversold: 25, cciLevel: 150, lotSize: 0.05, slPips: 150, tpPips: 300 },
    { userId, symbol: "BTCUSD", timeframe: "M15,H1", lotSize: 0.02, slPips: 400, tpPips: 800 },
    { userId, symbol: "GBPJPY", timeframe: "H1,H4", useDivergence: true, lotSize: 0.08 },
    { userId, symbol: "US100", timeframe: "M15,M30", lotSize: 0.1, slPips: 40, tpPips: 90 },
    { userId, symbol: "US30", timeframe: "M30", enabled: false, lotSize: 0.2 },
  ]);

  await db.insert(signals).values([
    {
      userId, symbol: "XAUUSD", side: "BUY", timeframe: "M15", price: 2384.52, sl: 2369.5, tp: 2414.5, volume: 0.05,
      reason: "RSI 24.8 aşırı satımdan dönüş + CCI -168 + boğa uyumsuzluğu",
      indicators: { RSI: 24.8, CCI: -168.2, Stoch: 12.4, divergence: "bullish" },
      confidence: 82, status: "pending", source: "demo", createdAt: min(2),
    },
    {
      userId, symbol: "EURUSD", side: "SELL", timeframe: "H1", price: 1.08742, sl: 1.09042, tp: 1.08142, volume: 0.1,
      reason: "RSI 73.1 aşırı alım + CCI 142 + ayı uyumsuzluğu",
      indicators: { RSI: 73.1, CCI: 142.6, Stoch: 88.1, divergence: "bearish" },
      confidence: 71, status: "executed", source: "demo", createdAt: min(95), decidedAt: min(94),
    },
    {
      userId, symbol: "GBPJPY", side: "BUY", timeframe: "H4", price: 197.214, sl: 196.9, tp: 197.85, volume: 0.08,
      reason: "RSI 29.4 + CCI -104",
      indicators: { RSI: 29.4, CCI: -104.3, Stoch: 18.9 },
      confidence: 58, status: "rejected", source: "demo", createdAt: min(240), decidedAt: min(238),
    },
  ]);

  await db.insert(trades).values([
    { userId, ticket: "100482211", symbol: "EURUSD", side: "SELL", volume: 0.1, openPrice: 1.08742, currentPrice: 1.08611, sl: 1.09042, tp: 1.08142, pnl: 131, comment: "JARVIS SELL H1", timeframe: "H1", openedAt: min(94) },
    { userId, ticket: "100482574", symbol: "XAUUSD", side: "BUY", volume: 0.05, openPrice: 2371.1, currentPrice: 2384.52, sl: 2356, tp: 2401, pnl: 67.1, comment: "JARVIS AUTO M15", timeframe: "M15", openedAt: min(180) },
    { userId, ticket: "100481930", symbol: "US30", side: "BUY", volume: 0.2, openPrice: 39120, currentPrice: 39221.5, pnl: 20.3, comment: "manuel", timeframe: "MAN", openedAt: min(300) },
    { userId, ticket: "100479002", symbol: "GBPUSD", side: "BUY", volume: 0.1, openPrice: 1.2701, currentPrice: 1.2754, pnl: 53, status: "closed", comment: "JARVIS BUY", openedAt: min(1440), closedAt: min(1200) },
    { userId, ticket: "100478100", symbol: "XAUUSD", side: "BUY", volume: 0.05, openPrice: 2351.2, currentPrice: 2366.9, pnl: 78.5, status: "closed", comment: "JARVIS BUY", openedAt: min(4300), closedAt: min(4100) },
    { userId, ticket: "100477650", symbol: "EURUSD", side: "SELL", volume: 0.1, openPrice: 1.0912, currentPrice: 1.0861, pnl: 51, status: "closed", comment: "JARVIS SELL", openedAt: min(7200), closedAt: min(6900) },
    { userId, ticket: "100477001", symbol: "GBPJPY", side: "BUY", volume: 0.08, openPrice: 196.4, currentPrice: 196.1, pnl: -15.8, status: "closed", comment: "JARVIS BUY", openedAt: min(9000), closedAt: min(8800) },
    { userId, ticket: "100478811", symbol: "USDJPY", side: "SELL", volume: 0.1, openPrice: 157.42, currentPrice: 157.71, pnl: -18.4, status: "closed", comment: "JARVIS SELL", openedAt: min(2000), closedAt: min(1900) },
  ]);

  await db.insert(aiProviders).values([
    { userId, name: "Ollama (yerel)", kind: "ollama", baseUrl: "http://localhost:11434", model: "qwen2.5-coder:14b", isLocal: true, isActive: true },
    { userId, name: "LM Studio", kind: "openai_compat", baseUrl: "http://localhost:1234/v1", model: "hermes-3-llama-3.1-8b", isLocal: true },
    { userId, name: "OmniRoute / Hermes Router", kind: "openai_compat", baseUrl: "http://localhost:20128/v1", model: "auto", isLocal: true },
  ]);

  await db.insert(messages).values([
    { userId, role: "assistant", content: "Sistemler çevrimiçi efendim. 3 parite izleniyor, 1 bekleyen sinyal var: XAUUSD BUY. Onay bekliyorum.", createdAt: min(2) },
  ]);
  await ensureKanal(userId);
  await ensureKanalStrategies(userId);
}
