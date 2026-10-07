       IDENTIFICATION DIVISION.
       PROGRAM-ID. MENU.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN.
          05 WS-ACTION       PIC X.
          05 FILLER          PIC X(39).
       01 WS-LEN             PIC S9(4) COMP VALUE 40.
       01 WS-MSG             PIC X(8).
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-IN) LENGTH(WS-LEN) END-EXEC
           EVALUATE WS-ACTION
               WHEN 'A'
                   MOVE 'ADDED' TO WS-MSG
               WHEN 'D'
                   MOVE 'DELETED' TO WS-MSG
           END-EVALUATE
           EXEC CICS SEND TEXT FROM(WS-MSG) LENGTH(8) END-EXEC
           EXEC CICS RETURN END-EXEC.
