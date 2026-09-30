       IDENTIFICATION DIVISION.
       PROGRAM-ID. SYSIDOK.
      * The terminal picks one of two regions the program knows.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-INPUT.
          05 WS-REGION   PIC X(4).
       01 WS-AREA        PIC X(100).
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-INPUT) LENGTH(LENGTH OF WS-INPUT)
           END-EXEC
           EVALUATE WS-REGION
             WHEN 'CIC1'
             WHEN 'CIC2'
               CONTINUE
             WHEN OTHER
               EXEC CICS RETURN END-EXEC
           END-EVALUATE
           EXEC CICS LINK PROGRAM('ACCTINQ') COMMAREA(WS-AREA)
                SYSID(WS-REGION) END-EXEC
           EXEC CICS RETURN END-EXEC.
