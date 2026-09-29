       IDENTIFICATION DIVISION.
       PROGRAM-ID. CALLER.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-REC.
          05 WS-DATE          PIC X(8).
          05 WS-REST          PIC X(10).
       01 WS-SHORT            PIC X(5).
       01 WS-EXACT            PIC X(10).
       01 WS-N                PIC 9(4) COMP.
       01 WS-TAB              PIC X(12).
       PROCEDURE DIVISION.
           CALL 'CALLEE' USING WS-DATE WS-SHORT
           CALL 'EXACT' USING WS-EXACT
           CALL 'VARTAB' USING WS-N WS-TAB
           CALL 'TWICE' USING WS-SHORT
           CALL 'BYVAL' USING BY VALUE WS-N
           GOBACK.
