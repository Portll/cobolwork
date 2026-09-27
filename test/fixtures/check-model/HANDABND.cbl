       IDENTIFICATION DIVISION.
       PROGRAM-ID. HANDABND.
      * The performed section always abends, and the abend's handler
      * label falls through to the section's end, so the PERFORM returns.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-LEN              PIC S9(4) COMP VALUE 4.
       01 WS-MSG              PIC X(20).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
       A000-MAIN SECTION.
           EXEC CICS RECEIVE INTO(WS-I) LENGTH(WS-LEN) END-EXEC
           PERFORM B000-CHECK
           MOVE 'X' TO WS-ENTRY(WS-I)
           EXEC CICS RETURN END-EXEC.
       B000-CHECK SECTION.
           EXEC CICS HANDLE ABEND LABEL(B000-RECOVER) END-EXEC
           EXEC CICS ABEND ABCODE('CHK1') END-EXEC.
       B000-RECOVER.
           MOVE 'RECOVERED' TO WS-MSG.
       B000-EXIT.
           EXIT.
